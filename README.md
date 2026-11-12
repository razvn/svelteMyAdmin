# svelteMyAdmin

A SvelteKit + Svelte 5 re-implementation of phpMyAdmin 5.2.3. See `docs/ROADMAP.md` for the plan and
`AGENTS.md` for development conventions.

## Requirements

- Node.js >= 22.13 (built-in `node:sqlite`), pnpm
- Docker (optional, for the integration test databases)

## Setup

```sh
pnpm install
cp config.sample.json config.json     # optional; keys match phpMyAdmin's $cfg. Set SMA_CONFIG to use another path
pnpm exec playwright install chromium # browsers for component + e2e tests
pnpm dev
```

## Databases for development / integration tests

```sh
pnpm db:up     # MySQL 8.4 on 127.0.0.1:33306, MariaDB 11.4 on 127.0.0.1:33307 (root / root)
pnpm db:down   # stop and delete data
```

Seeded with the fixture database `sma_test` and the phpMyAdmin configuration storage database
`phpmyadmin` (control user `pma` / `pmapass`).

## Configuration storage

Bookmarks, history, favourites, user preferences, relations, designer pages, tracking... live in the
`pma__*` tables.

- A server with `pmadb` set uses the MySQL pmadb exactly like phpMyAdmin (both applications can share it).
- A server **without** `pmadb` can use a SQLite file instead through the app-specific top-level key
  `ConfigStorage` (not a phpMyAdmin `$cfg` key):

  ```json
  { "ConfigStorage": { "type": "sqlite", "path": "./var/storage.sqlite" } }
  ```

  Relative paths resolve from the directory of the config file. The file and its schema (the `pma__*`
  tables of `create_tables.sql` ported to SQLite, plus a `server` column) are created on first use, so
  every feature is available and nothing has to be set up. One file serves all servers; a server is
  identified by `host:port` (or its socket), not by its position in `Servers`. Set
  `"ConfigStorage": false` on a server to keep it without any storage.

- Without either, the storage features are off (the server falls back to cookies/memory).

The storage page (`/server/check-relations`) shows which backend the server uses.

## Authentication

`auth_type` per server works like phpMyAdmin: `cookie` (login form, default), `config` and `http`.

Full guide: [docs/SIGNON.md](docs/SIGNON.md). Per-person audit log (who did what, when, from where):
[docs/AUDIT.md](docs/AUDIT.md).

`signon` delegates the login to an SSO proxy in front of the app (oauth2-proxy, an ingress `auth-url`).
The proxy authenticates the person and forwards identity headers. The app then connects to MySQL with
the server's `user`/`password` and shows the person as "alice (as root@host)". The identity source is the
app-specific key `Signon` (not a phpMyAdmin `$cfg` key):

```json
{
	"Servers": [
		{
			"host": "mysql",
			"auth_type": "signon",
			"user": "root",
			"password": "secret",
			"SignonURL": "/oauth2/start?rd=/",
			"LogoutURL": "/oauth2/sign_out?rd=/",
			"Signon": {
				"identity": {
					"type": "trusted-header",
					"userHeader": "x-auth-request-user",
					"emailHeader": "x-auth-request-email",
					"groupsHeader": "x-auth-request-groups",
					"trustedProxies": ["10.0.0.0/8"]
				}
			}
		}
	]
}
```

The header names shown are the defaults. Without the user header the browser is sent to `SignonURL`
(401 when unset), and "Log out" goes to `LogoutURL`.

Security: the headers are only read when the direct TCP peer is in `trustedProxies` (IPs or CIDR ranges,
required). The app must be reachable **only through the proxy**. Keep `trustedProxies` as tight as
possible and block direct access (ClusterIP Service plus a NetworkPolicy allowing only the proxy pods).
Otherwise anyone can forge the identity header. Every user shares the configured MySQL account. See
`docs/DELEGATED_AUTH.md` for the full design.

On Kubernetes, `Signon.authorize` lets the RBAC of a namespace decide who may use a server, and
`ServerDiscovery` finds the MySQL Services of labelled namespaces (one per merge request, say) with
their account from a Secret. See [Kubernetes RBAC](docs/SIGNON.md#kubernetes-rbac) and
[Server discovery](docs/SIGNON.md#server-discovery). A `Dockerfile` builds the image, and
[deploy/kubernetes](deploy/kubernetes/README.md) has manifests to try both on a local cluster.

## Hosted by svelteMultiAdmin

[svelteMultiAdmin](https://github.com/razvn/svelteMultiAdmin) bundles this app with svelteRedisAdmin behind one
sign-in. It starts this app with `auth_type: "signon"` (identity in headers it sets, from loopback only) and adds the top-level `Portal` key, which puts "Back to <label>" in the user menu:

```json
{ "Portal": { "url": "https://admin.example.com", "label": "Admin portal" } }
```

Only `http(s)` URLs are accepted. Without the key nothing changes. The audit log needs no extra setup: the
portal user is the identity of every event.

## Scripts

| Script                           | Purpose                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm dev` / `build` / `preview` | develop, build (adapter-node), preview                                                         |
| `pnpm check`                     | svelte-check                                                                                   |
| `pnpm lint` / `format`           | prettier + eslint                                                                              |
| `pnpm test`                      | unit + browser component tests                                                                 |
| `pnpm test:integration`          | SQL tests against the Docker databases                                                         |
| `pnpm test:e2e`                  | Playwright end-to-end tests                                                                    |
| `pnpm db:up` / `db:down`         | Docker databases                                                                               |
| `pnpm site:screenshots`          | regenerate `site/` screenshots (running app at `SITE_BASE_URL`, default http://localhost:5173) |

## Production

```sh
pnpm build
SMA_CONFIG=/path/to/config.json node build
```

### Import: upload size and limits

The import page streams the uploaded file (it is never buffered for SQL and CSV), but `adapter-node`
rejects request bodies larger than `BODY_SIZE_LIMIT` (default **512K**). Raise it when you run the
server, e.g. `BODY_SIZE_LIMIT=2G SMA_CONFIG=... node build` (`Infinity` disables the limit). The page
shows the limit and `Import.max_upload_size` in `config.json` can lower it. `ExecTimeLimit` is the time
budget of interruptible imports (resume with the skip count) and `MemoryLimit` caps the formats that are
read into memory (ODS, XML, MediaWiki, CSV at database/server level; default 512M). `LOAD DATA` imports
need `local_infile=ON` on the MySQL server. bzip2 files are not supported.

## License

svelteMyAdmin is free software released under the [GNU General Public License v2.0 or later](LICENSE)
(GPL-2.0-or-later), the same license as phpMyAdmin, whose translations and configuration storage
schema it reuses. It is an independent project, not affiliated with phpMyAdmin, Oracle or MariaDB.
