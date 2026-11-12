# Single sign-on with `auth_type: "signon"`

`signon` lets an SSO proxy in front of svelteMyAdmin log people in. The proxy (oauth2-proxy, an
ingress `auth-url`, Pomerium…) authenticates the person against your identity provider and forwards
who they are in HTTP headers. svelteMyAdmin trusts those headers only when the request comes from the
proxy, then connects to MySQL with the account configured for the server.

Running behind [svelteMultiAdmin](MULTIADMIN.md)? It sets `signon` up itself: see [MULTIADMIN.md](MULTIADMIN.md).

Nobody types a MySQL password, and the password never reaches the browser.

## How a request is handled

1. The TCP peer of the request (the proxy) must be in `Signon.identity.trustedProxies`. From any other
   address the identity headers are ignored, because anyone can send them.
2. The user header must hold a non-empty name with no control characters and no comma. A comma means the
   header arrived twice, which happens when a proxy appends instead of replacing.
3. With `Signon.authorize` set (on by default for [discovered servers](#server-discovery)), Kubernetes RBAC must allow the person on the server
   ([Kubernetes RBAC](#kubernetes-rbac)). Denied: `403`. RBAC cannot be checked: `503`.
4. The app connects with the server's `user` / `password`. `AllowDeny`, `AllowRoot` and
   `AllowNoPassword` apply to that MySQL account and to the client IP.
5. No identity: redirect to `SignonURL`, or `401 Authentication required.` when it is empty.
   MySQL refuses the configured account: `503`.

The headers are read again on every request. svelteMyAdmin keeps no session of its own for `signon`, so
the proxy stays the only source of truth: when its session ends, access ends.

## Configuration

```json
{
	"Servers": [
		{
			"verbose": "Production",
			"host": "mysql",
			"auth_type": "signon",
			"user": "admin",
			"password": "secret",
			"SignonURL": "/oauth2/start?rd=/",
			"LogoutURL": "/oauth2/sign_out?rd=/",
			"Signon": {
				"identity": {
					"type": "trusted-header",
					"userHeader": "x-auth-request-user",
					"emailHeader": "x-auth-request-email",
					"groupsHeader": "x-auth-request-groups",
					"trustedProxies": ["10.42.0.0/16"]
				}
			}
		}
	]
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `user`, `password` | `root`, empty | MySQL account the app connects with for every signed-in person. |
| `SignonURL` | empty | phpMyAdmin key. Where people without an identity are sent. Empty gives a plain 401. |
| `LogoutURL` | empty (`/`) | phpMyAdmin key. Where "Log out" sends the browser, normally the proxy's sign-out. |
| `Signon.identity.type` | `trusted-header` | The only identity source so far. |
| `Signon.identity.userHeader` | `x-auth-request-user` | Header with the person's stable id (username). Required. |
| `Signon.identity.emailHeader` | `x-auth-request-email` | Optional. |
| `Signon.identity.groupsHeader` | `x-auth-request-groups` | Optional, comma separated. |
| `Signon.identity.trustedProxies` | none | IPs or CIDRs (IPv4 or IPv6) of the proxy. Required and non-empty, otherwise the config fails to load. |

`Signon` is specific to svelteMyAdmin; phpMyAdmin ignores it. `SignonURL` and `LogoutURL` keep their
phpMyAdmin meaning. phpMyAdmin's `SignonSession`, `SignonScript` and `SignonCookieParams` are not used.

`trustedProxies` is matched against the direct TCP peer, not against `TrustedProxies` (the top-level key
that only decides which header carries the real client IP for `AllowDeny` and logs). Behind a load
balancer that also forwards, list the address the app actually sees.

## Proxy setups

### oauth2-proxy behind ingress-nginx (`auth_request` mode)

oauth2-proxy runs with `--set-xauthrequest`, and the ingress copies its response headers onto the
request sent to svelteMyAdmin:

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/auth-url: 'https://$host/oauth2/auth'
    nginx.ingress.kubernetes.io/auth-signin: 'https://$host/oauth2/start?rd=$escaped_request_uri'
    nginx.ingress.kubernetes.io/auth-response-headers: 'X-Auth-Request-User,X-Auth-Request-Email,X-Auth-Request-Groups'
```

The peer svelteMyAdmin sees is the ingress controller pod, so `trustedProxies` is the pod network range
of the ingress controller. The default header names already match.

### oauth2-proxy as the reverse proxy

With oauth2-proxy forwarding straight to svelteMyAdmin (`--upstream=http://sma:3000`,
`--pass-user-headers`), the identity arrives as `X-Forwarded-User` / `X-Forwarded-Email` /
`X-Forwarded-Groups`. Set the header names accordingly:

```json
"Signon": {
	"identity": {
		"userHeader": "x-forwarded-user",
		"emailHeader": "x-forwarded-email",
		"groupsHeader": "x-forwarded-groups",
		"trustedProxies": ["10.42.3.17"]
	}
}
```

## Kubernetes RBAC

On a review environment where every merge request gets its own namespace and its own MySQL, the
question "may this person use this server?" already has an answer: the RBAC of the namespace.
`Signon.authorize` asks the Kubernetes API server, with a
[SubjectAccessReview](https://kubernetes.io/docs/reference/access-authn-authz/authorization/#checking-api-access),
whether the signed-in person may `get pods` (by default) in the server's namespace. People without that
right get a `403` instead of the server.

```json
{
	"Servers": [
		{
			"verbose": "review-123",
			"host": "mysql.review-123.svc",
			"auth_type": "signon",
			"user": "root",
			"password": "secret",
			"Signon": {
				"identity": { "trustedProxies": ["10.42.0.0/16"] },
				"authorize": {
					"type": "kubernetes-sar",
					"namespace": "review-123",
					"resource": { "group": "", "resource": "pods", "verb": "get" },
					"userPrefix": "oidc:",
					"groupsPrefix": "oidc:",
					"cacheSeconds": 60
				}
			}
		}
	]
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `authorize.type` | none | `kubernetes-sar`, the only authoriser so far. |
| `authorize.namespace` | none | Namespace whose RBAC decides. Required, a DNS-1123 label. |
| `authorize.resource.group` | empty (core API) | API group of the resource. |
| `authorize.resource.resource` | `pods` | Resource the person must have the right on. |
| `authorize.resource.verb` | `get` | Verb they must be allowed. |
| `authorize.resource.subresource` | none | Optional, e.g. `exec` with `pods` and verb `create`, or `proxy` with `services`. |
| `authorize.userPrefix` | empty | Prepended to the identity user. Must equal the API server's `--oidc-username-prefix`. |
| `authorize.groupsPrefix` | empty | Prepended to each group. Must equal the API server's `--oidc-groups-prefix`. |
| `authorize.cacheSeconds` | `60` | How long an answer, allowed or denied, is reused. `0` asks on every request. |
| `authorize.apiServer` | in cluster | `https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT`. `http://` works too, e.g. `kubectl proxy`. |
| `authorize.tokenFile` | `/var/run/secrets/kubernetes.io/serviceaccount/token` | Bearer token of the app's ServiceAccount. Read again on every lookup, so projected tokens can rotate. |
| `authorize.caFile` | `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt` | CA that signs the API server certificate (`https://` only). |

`Signon.authorize` is only accepted on `auth_type: "signon"` servers; elsewhere the config fails to load.

### Naming must match the cluster

The review asks about `userPrefix + <user header>` in the groups `groupsPrefix + <each group>` plus
`system:authenticated`. Those must be the names your RoleBindings use, which are the names the API
server gives OIDC users. If the cluster runs with `--oidc-username-claim=preferred_username
--oidc-username-prefix=oidc: --oidc-groups-prefix=oidc:` and the proxy forwards the GitLab username and
groups, use `"userPrefix": "oidc:"` and `"groupsPrefix": "oidc:"`. Check with
`kubectl auth can-i get pods -n review-123 --as oidc:alice --as-group oidc:my-team`.

The e-mail header is not sent to Kubernetes.

### RBAC for the app

The app's ServiceAccount needs `create` on `subjectaccessreviews`, which the built-in ClusterRole
`system:auth-delegator` grants:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sveltemyadmin
  namespace: tools
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: sveltemyadmin-auth-delegator
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: system:auth-delegator
subjects:
  - kind: ServiceAccount
    name: sveltemyadmin
    namespace: tools
```

Run the Deployment with `serviceAccountName: sveltemyadmin` and keep `automountServiceAccountToken`
on (the default), so the token and CA appear at the default paths.

### Who may use a namespace

Grant people the right the review checks. Here the GitLab group `my-team` may get pods in `review-123`,
and therefore use the MySQL server of that namespace:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: review-123
rules:
  - apiGroups: ['']
    resources: ['pods']
    verbs: ['get']
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-team-pod-reader
  namespace: review-123
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-reader
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: Group
    name: oidc:my-team
```

The built-in ClusterRole `view`, bound with a RoleBinding in the namespace, works as well.

### Caching and failures

- Answers are cached in memory per API server, namespace, resource, user and set of groups, for
  `cacheSeconds`. A RoleBinding you remove takes effect after at most that delay. Identical lookups
  that arrive together share one request.
- Errors are never cached. If the API server is unreachable, answers with an error status, an
  unreadable body, or does not answer within 5 seconds, the request fails closed with
  `503 Cannot verify your access right now.` The cause goes to the server log, never the token.
- The check runs before any MySQL connection is opened. Public pages (`/login`, `/api/health`) still
  render for a refused person, as if they were signed out.
- With the [audit log](AUDIT.md) on, refusals are logged as `denied` events with reason `not-authorized`
  or `authorization-error`.

## Server discovery

With one MySQL per merge request, listing every review environment in `Servers` does not scale.
`ServerDiscovery` asks the Kubernetes API which namespaces and MySQL Services exist, and offers each one
as a `signon` server. The connecting account is read from a Secret of the namespace, and RBAC of the
same namespace decides who may use it. The check is on by default.

```json
{
	"Servers": [],
	"ServerDiscovery": {
		"type": "kubernetes",
		"namespaceSelector": "env=review",
		"serviceSelector": "app.kubernetes.io/name=mysql",
		"port": "mysql",
		"verbose": "{namespace}: {annotation:gitlab.com/mr-title}",
		"secret": { "name": "mysql-auth", "user": "root", "passwordKey": "mysql-root-password" },
		"authorize": { "userPrefix": "oidc:", "groupsPrefix": "oidc:" },
		"server": {
			"Signon": { "identity": { "trustedProxies": ["10.42.0.0/16"] } },
			"pmadb": "phpmyadmin",
			"SignonURL": "/oauth2/start"
		}
	}
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `type` | none | `kubernetes`, the only provider so far. |
| `namespaceSelector` | none | Label selector of the namespaces to look in, e.g. `env=review`. Required. |
| `serviceSelector` | none | Label selector of the MySQL Services in them. Required. |
| `port` | `mysql` | Service port, by name or number. A name the Service lacks falls back to its only port; Services with several ports and none matching are skipped. |
| `host` | `{service}.{namespace}.svc` | Host the app connects to. |
| `verbose` | `{namespace}` | Name shown in the server switcher. Blank after filling: `<namespace>/<service>`. |
| `secret.name` | none | Secret in the namespace that holds the MySQL account. Required. |
| `secret.user` | `root` | User name, unless `secret.userKey` names a key of the Secret holding it. |
| `secret.userKey` | none | Key of the Secret with the user name. |
| `secret.passwordKey` | none | Key of the Secret with the password. Required. |
| `authorize` | `get pods` | The RBAC question of [Kubernetes RBAC](#kubernetes-rbac) without `namespace` and API access keys, asked in each server's own namespace. `false` lets in everyone the proxy lets through. |
| `refreshSeconds` | `30` | How long the server list and each Secret are reused. At least 5. |
| `server` | `{}` | Settings of every discovered server, like an entry of `Servers`: `Signon.identity` (required), `pmadb`, `controluser`, `SignonURL`, `LogoutURL`, `hide_db`... Not `auth_type`, `host`, `port`, `socket`, `user`, `password` or `verbose`. |
| `apiServer`, `tokenFile`, `caFile` | in cluster | As for `Signon.authorize`. |

Ready-made manifests (the app with this config and RBAC, two example review environments) and a
local walkthrough are in [deploy/kubernetes](../deploy/kubernetes/README.md).

`host`, `verbose` and `secret.name` accept `{namespace}`, `{service}`, `{label:<key>}` and
`{annotation:<key>}`. Labels and annotations are the namespace's own. A missing one fills in as empty.

### How discovered servers behave

- They come after the servers of `Servers`, sorted by namespace and Service. Configured servers keep
  their position, so `?server=2` and cookie sessions keep working. A discovered server is named by its
  id, `k8s:<namespace>/<service>`: `/?server=k8s:review-123/mysql` opens it.
- The chosen server is remembered in the `sma_server` cookie, so the next pages stay on it. A server
  that disappeared (merged MR, deleted namespace) is no longer offered.
- When nobody chose a server (no `?server=`, nothing remembered, or the remembered one is gone), the
  request goes to `ServerDefault`, the first server there is. If RBAC refuses the person there, a `GET`
  is redirected to the first server RBAC allows them on, so nobody lands on a dead end. If it allows
  them nowhere: `403 You do not have access to any database server.` A server asked for explicitly
  keeps its `403`.
- The server switcher only lists the servers whose RBAC lets the person in, plus the current one. Each
  check is the same cached review as the request itself makes. A server whose check fails is hidden.
- Two API calls list the namespaces and the Services, at most once per `refreshSeconds`. The first
  request waits for the list; later ones get the current list while a newer one loads in the background.
  If a refresh fails, the previous list stays in use and the error goes to the server log.
- A Secret is read when a request needs that server, and kept in memory for `refreshSeconds`. It never
  goes into a cookie, a page or a log.
- With no server configured and none discovered, pages answer `503 No database server is available
  right now.` If the first listing fails: `503 Cannot list the database servers right now.` If the
  Secret cannot be read: `503 Cannot read the account of this server right now.` `/api/health` answers
  in all cases, so liveness probes do not depend on the API server.

### RBAC for discovery

On top of `system:auth-delegator` (see [RBAC for the app](#rbac-for-the-app)), the ServiceAccount
needs to list namespaces and Services cluster-wide, and to read the MySQL Secret in the review
namespaces. Restrict the Secret right to its name:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: sveltemyadmin-discovery
rules:
  - apiGroups: ['']
    resources: ['namespaces', 'services']
    verbs: ['list']
  - apiGroups: ['']
    resources: ['secrets']
    resourceNames: ['mysql-auth']
    verbs: ['get']
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: sveltemyadmin-discovery
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: sveltemyadmin-discovery
subjects:
  - kind: ServiceAccount
    name: sveltemyadmin
    namespace: tools
```

A ClusterRoleBinding lets the app read `mysql-auth` in every namespace. To limit it to the review
namespaces, bind the ClusterRole with a RoleBinding in each of them instead, from the pipeline that
creates the namespace. The list rights still need the ClusterRoleBinding.

## Security checklist

Trusted headers are only as safe as the network path in front of the app.

- **The app must be unreachable except through the proxy.** Bind the Service to `ClusterIP` (or
  `127.0.0.1`), and add a NetworkPolicy or firewall rule that only lets the proxy in. If a person can
  reach the app from an address listed in `trustedProxies`, they can be anyone.
- **Keep `trustedProxies` tight.** Prefer the proxy's own addresses over a whole private range.
- **Make the proxy overwrite the identity headers**, never pass client-supplied ones through. Test it:
  send `X-Auth-Request-User: someone-else` through the proxy and check the user menu.
- **The MySQL account is shared.** Everyone signed in acts as `user`. Give it only the privileges the
  team needs.
- Two-factor authentication is skipped for `signon` servers. Enforce MFA in the identity provider.

## What people see

- The user menu shows the identity and the account, e.g. `alice (as admin@mysql)`.
- "Change password" is hidden: changing the shared account's password would lock everyone out.
- "Log out" sends the browser to `LogoutURL`.
- Each person has their own preferences, query history, recent and favourite tables, bookmarks, saved
  searches, table UI settings (sorting, column order), export templates, designer settings and hidden
  navigation items. They are stored under the identity, not under the shared MySQL account.
- Change tracking records the identity as the author of each change.
- User groups (menu restrictions) still apply per MySQL account, so everyone on the server gets the
  shared account's group.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Config fails to load, `Servers.N.Signon.identity.trustedProxies` | Missing, empty, or an entry that is not an IP or CIDR. |
| Always `401` or sent to `SignonURL` | The peer is not in `trustedProxies` (check the address the app sees, IPv6 included), the user header name does not match, or the header is empty or duplicated. |
| `503 Cannot log in to the MySQL server with the configured credentials.` | MySQL rejected the server's `user` / `password`. |
| `403` with `AllowDeny` message | A rule matched the shared MySQL account or the client IP. |
| `403 You do not have access to this server (Kubernetes namespace …)` | RBAC denies the person. Check the RoleBinding and the prefixes with `kubectl auth can-i … --as … --as-group …`. A fix shows after `cacheSeconds`. |
| `503 Cannot verify your access right now.` | The SubjectAccessReview failed; the server log says why. Common causes: no `system:auth-delegator` binding (HTTP 403 from the API), `apiServer` unset outside a cluster, unreadable `tokenFile` / `caFile`. |
| Config fails to load, `ServerDiscovery…` | A required key is missing (`namespaceSelector`, `serviceSelector`, `secret.name`, `secret.passwordKey`, `server.Signon.identity.trustedProxies`), a template uses another placeholder, or `server` sets a key discovery fills in. |
| A review environment is missing from the switcher | Its namespace or Service lacks the selector labels, the Service has several ports and none named `port`, RBAC denies the person, or the list is younger than `refreshSeconds`. |
| `403 You do not have access to any database server.` | RBAC allows the person on none of the servers. Check their RoleBindings, and the prefixes, with `kubectl auth can-i … --as … --as-group …`. |
| `503 Cannot list the database servers right now.` | The first listing failed: no `list` right on namespaces or Services (HTTP 403 in the server log), or the API server is unreachable. |
| `503 Cannot read the account of this server right now.` | No `get` right on the Secret, the Secret does not exist, or it lacks `secret.passwordKey` / `secret.userKey`. |
| Config fails to load, `Servers.N.Signon.authorize…` | `namespace` missing or not a DNS-1123 label, `apiServer` not an `http(s)` URL, or `authorize` on a non-`signon` server. |

## Current limits

- Per-person storage is keyed by the bare identity name, as phpMyAdmin keys it by the bare username.
  When several servers share one configuration storage (the same `pmadb`, or the SQLite storage of
  one `host:port`), an identity named like a MySQL user who logs in to another of those servers sees that
  user's rows, and the other way round.
- MySQL's own logs only see the shared account. Turn on the [audit log](AUDIT.md) to record who did what,
  when and from where, per person.
- Without `Signon.authorize` (or with `ServerDiscovery.authorize: false`), authorisation is
  all-or-nothing: whoever the proxy lets through gets the server.
- Caches (server list, Secrets, RBAC answers) are per process. With several replicas, each one asks the
  API server on its own, and a change can show on one replica before another.
- Discovery polls; it does not watch. A new review environment appears within `refreshSeconds`.
