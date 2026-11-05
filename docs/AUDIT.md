# Audit log

With `auth_type: "signon"` everyone shares one MySQL account, so MySQL's own logs only ever see that
account. The audit log records, per person, who did what, when, from where and on which server. It works
for every auth type: with `cookie`, `http` and `config` the person is the MySQL user.

The log is off unless the top-level key `AuditLog` is set. When it is off, nothing is wrapped and no
cookie is set.

## What is logged

One JSON object per line (JSON Lines). Every line has these fields:

| Field         | Meaning                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `ts`          | ISO 8601 time, UTC.                                                                                     |
| `event`       | `session`, `statement`, `export`, `logout` or `denied`.                                                 |
| `identity`    | The verified person: the SSO identity for `signon`, else the MySQL user. `null` on `denied` lines.      |
| `mysqlUser`   | The MySQL account used (the shared one for `signon`). `null` when none was accepted.                    |
| `email`       | `signon` only, when the proxy forwards it.                                                              |
| `server`      | Server label: `verbose`, else `host:port`.                                                              |
| `serverId`    | Server id: the 1-based position in `Servers` as text, or `k8s:<namespace>/<service>` for a [discovered](SIGNON.md#server-discovery) server. |
| `clientIp`    | Client address, resolved through the top-level `TrustedProxies` like the rest of the app.               |

### `session`

The first request of a person, and the first one after `sessionIdleMinutes` without any request. A
sealed browser cookie (`sma_audit`, AES-GCM with a key derived from `blowfish_secret`) holds who was last
seen, on which server and when. It slides forward on every request. A missing, tampered, or expired
marker, or one for another person or server, starts a new session. "Log out" clears it.

```json
{"ts":"2026-11-04T09:12:03.120Z","event":"session","identity":"alice","mysqlUser":"admin","email":"alice@example.com","server":"Production","serverId":"1","clientIp":"203.0.113.7"}
```

### `statement`

Every write statement run for the person, whether it succeeded or failed: `INSERT`, `UPDATE`,
`DELETE`, `REPLACE`, `TRUNCATE`, `CREATE`/`ALTER`/`DROP` of tables, views, indexes and databases, and
`RENAME TABLE`. These are the statements change tracking records, and the same predicate decides both.
It does not matter where in the app they come from: the SQL page, insert/edit, inline edit, structure,
operations or import.

| Field                | Meaning                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `db`                 | Database selected with `USE` before the statement, else `null` (most generated SQL names the database itself). |
| `sql`                | Statement text, cut to `maxSqlLength` characters (`truncated: true` then).                                     |
| `ok`                 | `true` when MySQL ran it.                                                                                     |
| `affectedRows`       | When `ok` and MySQL reports it.                                                                               |
| `errorCode`          | When not `ok`: the MySQL error code (`ER_DUP_ENTRY`, ...). The error message is never logged.                 |

```json
{"ts":"2026-11-04T09:14:40.002Z","event":"statement","identity":"alice","mysqlUser":"admin","email":"alice@example.com","server":"Production","serverId":"1","clientIp":"203.0.113.7","db":"shop","sql":"UPDATE `orders` SET `status` = 'shipped' WHERE `id` = 1042","ok":true,"affectedRows":1}
{"ts":"2026-11-04T09:15:02.871Z","event":"statement","identity":"alice","mysqlUser":"admin","email":"alice@example.com","server":"Production","serverId":"1","clientIp":"203.0.113.7","db":null,"sql":"DROP TABLE `shop`.`orders`","ok":false,"errorCode":"ER_ROW_IS_REFERENCED_2"}
```

**Also logged**: administration that change tracking ignores. That covers accounts and privileges (`CREATE`/`ALTER`/`DROP`/`RENAME USER`, roles, `GRANT`, `REVOKE`, `SET PASSWORD`), routines, events and triggers, `CALL`, `SET GLOBAL`, `KILL`, `FLUSH`, `LOAD DATA`, plugins and replication control. Passwords and password hashes in these statements are always replaced with `'***'`, `includeValues` or not:

```json
{"ts":"2026-11-04T09:16:10.420Z","event":"statement","identity":"alice","mysqlUser":"admin","server":"Production","serverId":"1","clientIp":"203.0.113.7","db":null,"sql":"CREATE USER 'bob'@'%' IDENTIFIED BY '***'","ok":true,"affectedRows":0}
```

**Not logged**: reads (`SELECT`, `SHOW`, `EXPLAIN`, ...). The app runs its own reads on the same
connection, so they say nothing about the person. The app's own bookkeeping in the configuration storage (recent
tables, history, preferences, tracking rows) is not logged.

### `export`

Every export, downloaded or viewed as text.

| Field       | Meaning                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------- |
| `scope`     | `server`, `db`, `table`, or `rows` (selected rows, or the result of a query).            |
| `format`    | Export plugin id: `sql`, `csv`, `json`, ...                                              |
| `db`        | The database, except for `server` exports.                                               |
| `databases` | `server` exports: the databases selected.                                                |
| `tables`    | `db` exports: the tables selected. `table` and `rows` exports: the table.                 |
| `sql`       | `rows` exports of a query: the query.                                                    |

```json
{"ts":"2026-11-04T09:20:11.530Z","event":"export","identity":"alice","mysqlUser":"admin","server":"Production","serverId":"1","clientIp":"203.0.113.7","scope":"db","format":"csv","db":"shop","tables":["customers","orders"]}
```

### `logout`

"Log out" by an authenticated person.

```json
{"ts":"2026-11-04T10:02:45.017Z","event":"logout","identity":"alice","mysqlUser":"admin","server":"Production","serverId":"1","clientIp":"203.0.113.7"}
```

### `denied`

Refused access. `identity` is `null` because nobody was verified. `claimedUser` is the name that was
presented, as sent.

| `reason`                                       | When                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `allow-denied`, `root-denied`, `empty-denied`  | An `AllowDeny`, `AllowRoot` or `AllowNoPassword` rule refused the account or client IP.   |
| `untrusted-proxy`                              | `signon`: the user header came from a peer outside `Signon.identity.trustedProxies`.      |
| `invalid-identity`                             | `signon`: the trusted proxy sent an unusable user header (control character, comma).      |
| `not-authorized`                               | `signon`: `Signon.authorize` (Kubernetes RBAC) refused the person on this server.          |
| `authorization-error`                          | `signon`: `Signon.authorize` could not be checked (API server unreachable or erroring).    |
| `access-denied`                                | MySQL refused the user name and password of a cookie or `http` login.                     |
| `login-failed`                                 | A cookie login could not reach MySQL or read the two-factor settings.                     |
| `invalid-login`                                | The login form was invalid: unknown server, empty user, oversized password, bad host.     |

```json
{"ts":"2026-11-04T09:30:00.441Z","event":"denied","identity":null,"mysqlUser":null,"server":"Production","serverId":"1","clientIp":"198.51.100.9","reason":"untrusted-proxy","claimedUser":"admin"}
```

Requests without any identity claim (anonymous page views, a `signon` request without the user header) are
not logged.

## Configuration

```json
{
	"AuditLog": { "target": "stdout" }
}
```

```json
{
	"AuditLog": {
		"target": "file",
		"path": "./var/audit.jsonl",
		"includeValues": false,
		"sessionIdleMinutes": 30,
		"maxSqlLength": 4096
	}
}
```

`AuditLog` is specific to svelteMyAdmin, not a phpMyAdmin `$cfg` key.

| Key                  | Default    | Meaning                                                                                                             |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `target`             | (required) | `stdout`, or `file`.                                                                                                |
| `path`               | (none)     | Required with `file`. Relative paths resolve from the directory of the config file. The directory must exist.       |
| `includeValues`      | `false`    | Inline the values the app passes apart from the SQL text (`?` placeholders). See [Values and personal data](#values-and-personal-data). |
| `sessionIdleMinutes` | `30`       | Inactivity after which a person's next request is a new `session`.                                                  |
| `maxSqlLength`       | `4096`     | Longer SQL text is cut, and the line gets `truncated: true`.                                                        |

## Why stdout and files, not the database

The log never goes into the `pma__*` tables or any other table. In a `signon` setup the shared MySQL
account usually has the rights to delete or rewrite rows there, so a person could erase their own
trail through the app. Lines written to stdout leave the process at once. The container runtime keeps
them, and a log collector can ship them off the node where nobody using the app can reach them.

## Values and personal data

With `includeValues: false`, values the app sends apart from the SQL text stay out of the log and the
statement keeps its `?` placeholders. That covers only those separately passed values. Many statements
carry their values inline: everything typed on the SQL page, and much of the SQL the app generates. Those
values are logged as part of `sql`. Treat the audit log as personal data: restrict who can read it, and
set a retention period in the log store. Lower `maxSqlLength` to keep large values (blobs, imports) out.

## Failure behaviour

The log fails open. If a line cannot be written (missing directory, full disk, closed stdout), the error
is reported once with `console.error` and the request goes on. Later lines to that file are dropped
until the app restarts. Watch for that `[audit]` message in the app's own logs.

## Shipping it from Kubernetes

Use `"target": "stdout"`. The kubelet writes container output to `/var/log/containers/*.log` on the
node, and a node-level collector (Fluent Bit, Vector, the OpenTelemetry Collector, Promtail) ships it to
your log store. Audit lines are the stdout lines whose JSON has an `event` field. Example Fluent Bit
filter that keeps them and drops the rest of the app's output:

```ini
[FILTER]
    Name    grep
    Match   kube.*svelte-my-admin*
    Regex   log ^\{"ts":"[^"]+","event":
```

Then parse `log` as JSON and index `identity`, `event` and `server`. Keep the log store outside the
namespace of the app, so the people the log is about cannot delete it.

With `"target": "file"`, mount a volume at the directory of `path` and run a sidecar that tails the file.
The app only appends to it, so rotate it with a tool that uses copy-and-truncate.
