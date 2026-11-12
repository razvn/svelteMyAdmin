# Hosted by svelteMultiAdmin

[svelteMultiAdmin](https://github.com/razvn/svelteMultiAdmin) is a portal that bundles svelteMyAdmin and
[svelteRedisAdmin](https://github.com/razvn/svelteRedisAdmin). People sign in once on the portal, then open this
app without a second login. The portal runs this app next to itself, proxies every request, and tells it who the
person is. This page lists what this app needs for that, what the portal does for you, and what stays your job.

You only need this page to understand the setup, or to wire your own gateway the same way. With the portal, you
write the app's normal config (servers, discovery, audit) and nothing about authentication.

## What the portal sets for you

When the portal starts this app, it reads your `config.json`, **overwrites these keys**, writes the result to a
private temporary file and points `SMA_CONFIG` at it. On every entry of `Servers`, and on the `server` template of
`ServerDiscovery`:

```json
{
	"auth_type": "signon",
	"SignonURL": "https://admin.example.com/go/myadmin",
	"LogoutURL": "https://admin.example.com/logout",
	"Signon": {
		"identity": {
			"type": "trusted-header",
			"userHeader": "x-multiadmin-user",
			"emailHeader": "x-multiadmin-email",
			"groupsHeader": "x-multiadmin-groups",
			"trustedProxies": ["127.0.0.1/32", "::1/128"]
		}
	}
}
```

(`auth_type` is not set on the discovery template: discovered servers are always `signon`.) Your own
`Signon.authorize` is kept. At the top level it also sets:

```json
{
	"TrustedProxies": { "127.0.0.1": "X-Forwarded-For", "::1": "X-Forwarded-For" },
	"Portal": { "url": "https://admin.example.com", "label": "Admin portal" }
}
```

`TrustedProxies` makes the audit log and `AllowDeny` see the real client address, which the portal passes in
`X-Forwarded-For`. The app is started with `HOST=127.0.0.1`, a loopback `PORT`, and `ORIGIN` set to its public
address, and without `ADDRESS_HEADER`, `XFF_DEPTH`, `PROTOCOL_HEADER`, `HOST_HEADER`, `SOCKET_PATH` and
`BODY_SIZE_LIMIT` in its environment.

This is [`auth_type: "signon"`](SIGNON.md) with the portal as the "proxy": the app trusts the identity headers
only from the loopback address, and re-reads them on every request.

## What you configure

| In `config.json`                       | Why it matters with the portal                                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Servers[].user` and `password`        | **Required on every server.** `signon` connects with the configured account, shared by everyone. A server without an explicit `user` makes the portal refuse to start the app, with a message naming the server. |
| `Servers[].verbose`                    | The name shown in the server switcher and in the audit log.                                                                                                                                                     |
| `ServerDiscovery`                      | Works as documented in [SIGNON.md](SIGNON.md#server-discovery). Its `server` template needs no `Signon.identity`: the portal adds it.                                                                          |
| `Signon.authorize` / `ServerDiscovery` | Kubernetes RBAC narrows who may use a server, using the name and groups from the portal. See [SIGNON.md](SIGNON.md#kubernetes-rbac).                                                                          |
| `AuditLog`                             | Recommended. The portal user is the `identity` of every event, with the MySQL account (`mysqlUser`) and the real client address. See [AUDIT.md](AUDIT.md).                                                     |
| `ConfigStorage` / `pmadb`              | Preferences, history and bookmarks are kept per person, keyed by the portal user name.                                                                                                                          |
| `blowfish_secret`                      | Set one: it is not derived from the portal's secret.                                                                                                                                                            |

You do **not** write: `auth_type`, `Signon.identity`, `SignonURL`, `LogoutURL`, `TrustedProxies`, `Portal`.

### Who may open the app

Access to svelteMyAdmin is **all or nothing** per person, decided by the portal's access rules (`myadmin: true`).
Once in, a person is the shared MySQL account of the server they pick. Narrow that with the MySQL privileges of
that account, and with `Signon.authorize` and discovery for per-namespace access. There is no per-person role or
server list here.

### Groups

For OIDC and trusted-header sign-in the portal passes the person's groups in `x-multiadmin-groups`, which feed
`Signon.authorize` (SubjectAccessReview). Groups of the portal's local accounts are never passed.

## The back-link

`Portal` adds **Back to <label>** to the user menu. It is optional: without it nothing changes, and an `http(s)`
URL is required because the value ends up in a link.

```json
{ "Portal": { "url": "https://admin.example.com", "label": "Admin portal" } }
```

## Logging out

"Log out" sends the browser to `LogoutURL`, which the portal points at its own `/logout`: it ends the portal
session on every host.

## Uploads

`adapter-node` rejects request bodies over `BODY_SIZE_LIMIT` (512 KB by default). The portal does not pass its own
limit to this app. Set `MULTIADMIN_MYADMIN_BODY_SIZE_LIMIT` (for example `512M`) in the portal's environment to
raise the limit for the import page.

## Wiring your own gateway

Do what the portal does:

1. Run the app so that **only your gateway can reach it** (loopback, a private network, a NetworkPolicy), with
   `HOST` and `PORT` set and `ORIGIN` set to the public address people use.
2. Put the keys above in `config.json`, with `trustedProxies` listing exactly your gateway's addresses.
3. In the gateway, **delete** `x-multiadmin-*`, `x-auth-request-*`, `Forwarded` and `X-Forwarded-*` from every
   incoming request, then set the user, email and groups from your own authentication. Send `X-Forwarded-For`
   with the real client address.
4. Do not set `ADDRESS_HEADER` or `XFF_DEPTH` on the app: the identity check relies on the real TCP peer.

Anything else able to reach the app from a trusted address can impersonate anyone. Do not run a sidecar you do
not trust next to it.

## Limits

- Everyone shares the MySQL account of the server, so MySQL cannot tell people apart. Turn on `AuditLog`.
- No per-person role or server filter, unlike svelteRedisAdmin.
- The app has no base path: the portal serves it on its own hostname.
