# Delegated authentication & dynamic servers — design

Status: **proposal** (not implemented). Target: an instance deployed on the Kubernetes review
environment of a project, where every merge request gets its own namespace with its own MySQL.

## Requirements (as agreed)

| Concern | Choice |
|---|---|
| Who is the user? | An SSO proxy in front of the app (oauth2-proxy / ingress `auth-url`) authenticates the user and forwards identity headers. |
| May they open this environment? | Kubernetes RBAC of the review namespace, checked with a `SubjectAccessReview`. |
| Which servers, which DB credentials? | Discovered through the Kubernetes API: MySQL services of review namespaces (by label), root password read from a Secret of the namespace. |
| What can they do once in? | Everything on every database of that server (the app connects with the namespace's admin account). |

Non-goals: per-database permissions for SSO users (MySQL privileges still apply to the account the
app connects with), writing to Kubernetes.

## Overview

```
Browser ──► Ingress ──► oauth2-proxy ──► svelteMyAdmin ──► MySQL (review-123 namespace)
                          │  X-Auth-Request-User / -Email / -Groups      │
                          └──────── OIDC (GitLab / Keycloak / …)         ├─► K8s API: SubjectAccessReview
                                                                         └─► K8s API: list Services, read Secret
```

Two independent extension points, both selected in `config.json`:

1. **Auth provider** — "who is the user, are they allowed on server N, which credentials to use".
2. **Server provider** — "which servers exist" (today: the static `Servers` array).

Both are plain TypeScript interfaces with built-in implementations, plus a `module` escape hatch
(like phpMyAdmin's `SignonScript`) to load your own implementation from a file path.

## 1. Auth provider: `auth_type: "signon"`

phpMyAdmin's equivalent is `auth_type = 'signon'` + `SignonScript` / `SignonSession`. We implement
the same `auth_type` with a provider chain instead of a PHP session:

```jsonc
// config.json (server entry, or `ServerDefaults` for discovered servers)
{
  "auth_type": "signon",
  "Signon": {
    // 1) identity: trust headers set by the proxy, only from these peers
    "identity": {
      "type": "trusted-header",
      "userHeader": "x-auth-request-user",
      "emailHeader": "x-auth-request-email",
      "groupsHeader": "x-auth-request-groups",
      "trustedProxies": ["10.0.0.0/8"]          // requests from elsewhere → 401
    },
    // 2) authorisation: Kubernetes RBAC of the server's namespace
    "authorize": {
      "type": "kubernetes-sar",
      "resource": { "group": "", "resource": "pods", "verb": "get" },   // or services/proxy, pods/exec…
      "cacheSeconds": 60
    },
    // 3) credentials: from the server definition (discovered Secret) — see server provider
    "credentials": { "type": "server" },
    // optional: replace any step with your own module
    // "module": "/etc/sma/auth.ts"
    "logoutUrl": "/oauth2/sign_out?rd=/"         // where "Log out" sends the browser
  }
}
```

### Provider interfaces (`src/lib/server/auth/signon/`)

```ts
export interface Identity {
  user: string;            // stable id from the proxy (e.g. GitLab username)
  email?: string;
  groups: string[];
}

export interface IdentitySource {
  /** null = not authenticated (→ 401 / redirect to the proxy sign-in). */
  identify(req: Request, clientIp: string | null): Promise<Identity | null>;
}

export interface Authorizer {
  /** May this identity use this server? Must be cached (per identity+server). */
  authorize(id: Identity, server: ResolvedServer): Promise<{ allowed: boolean; reason?: string }>;
}

export interface CredentialSource {
  /** MySQL account the app connects with for this identity on this server. */
  credentials(id: Identity, server: ResolvedServer): Promise<{ user: string; password: string }>;
}

/** What a `module` file may export (any subset; missing parts use the built-ins). */
export interface SignonModule {
  identity?: IdentitySource;
  authorize?: Authorizer;
  credentials?: CredentialSource;
}
```

### Request flow

1. `identify()` reads the headers **only** if the TCP peer is in `trustedProxies`
   (reusing `resolveClientIp`/`TrustedProxies` from the cookie auth). No identity → 401 with a link
   to the proxy sign-in.
2. `authorize()` for the selected server → `SubjectAccessReview` (below). Denied → 403 page
   ("You don't have access to namespace review-123"), never a MySQL login prompt.
3. `credentials()` → user/password of the server (from its Secret). The password never reaches the
   browser.
4. A **session cookie** (`sma_session`, existing AES-GCM sealing) caches `{identity, serverIndex,
   verifiedAt}` — *no password inside* for signon — so steps 1–3 don't hit Kubernetes on every
   request. The identity headers are still re-checked on every request (the proxy is the source of
   truth); the SAR result is re-validated after `cacheSeconds`.
5. Logout clears our cookie and redirects to `logoutUrl` (the proxy's sign-out).

Interaction with existing features: AllowDeny/AllowRoot apply to the MySQL account and are not
meaningful here (documented); 2FA is skipped for signon (the IdP does MFA); user preferences,
recent tables, etc. are keyed by the **identity user** (not the shared MySQL account), so each
person keeps their own settings in pmadb.

Required code change: `AuthPlugin.getCredentials` becomes async (`Promise<Credentials | null>`);
the hook already awaits a lazy connection, so the change is contained in `hooks.server.ts` and the
four plugins.

### Kubernetes `SubjectAccessReview`

```http
POST /apis/authorization.k8s.io/v1/subjectaccessreviews
{
  "apiVersion": "authorization.k8s.io/v1",
  "kind": "SubjectAccessReview",
  "spec": {
    "user": "alice",                       // identity.user (must match the cluster's OIDC username claim/prefix)
    "groups": ["gitlab:dev", "system:authenticated"],
    "resourceAttributes": { "namespace": "review-123", "verb": "get", "resource": "pods" }
  }
}
→ status.allowed: true | false
```

The app's ServiceAccount needs `create` on `subjectaccessreviews` (built-in ClusterRole
`system:auth-delegator`). Important: the `user`/`groups` sent must use the **same naming as the
cluster's OIDC config** (`--oidc-username-prefix`, `--oidc-groups-prefix`); a `userPrefix` /
`groupsPrefix` option handles that mapping.

## 2. Server provider: Kubernetes discovery

```jsonc
{
  "ServerProvider": {
    "type": "kubernetes",
    "namespaceSelector": "env=review",                        // label selector on namespaces
    "serviceSelector": "app.kubernetes.io/name=mysql",        // MySQL Services in each namespace
    "port": "mysql",                                          // named port or number
    "secret": { "name": "mysql-auth", "userKey": "username", "passwordKey": "root-password" },
    "verbose": "{namespace} — {annotation:gitlab.com/mr-title}",   // label shown in the server list
    "refreshSeconds": 30,
    "ServerDefaults": { "auth_type": "signon", "pmadb": "phpmyadmin", "controluser": "" }
  }
}
```

- Static `Servers` keep working; the provider's servers are appended (or replace them with
  `"mode": "replace"`).
- Servers get a **stable id** (`k8s:review-123/mysql`) instead of a 1-based index, so URLs and
  sessions survive MRs appearing/disappearing (`?server=k8s:review-123/mysql`). This touches the
  places that assume `serverIndex: number` (session payload, switcher, `?server=` parsing).
- The list is cached and refreshed in the background (watch or poll); a namespace deleted when the
  MR is merged disappears from the list and its sessions are rejected.
- The login page / server switcher only shows servers the identity is **authorised** on (SAR per
  namespace, cached) — with dozens of MRs, combined with the new server filter box.
- Credentials are read from the Secret on demand and kept in memory only (never logged, never in
  cookies). The ServiceAccount needs `get` on that Secret in review namespaces (a ClusterRole
  restricted by `resourceNames`), plus `list` namespaces/services.

## Security notes

- Trusted headers are only safe if the app is **not reachable except through the proxy**: bind the
  Service to ClusterIP, add a NetworkPolicy allowing only the proxy pods, and keep
  `trustedProxies` tight. Without that, anyone can forge `X-Auth-Request-User`.
- Prefer oauth2-proxy's signed headers / JWT (`--pass-authorization-header`, verify the ID token
  against the IdP JWKS) over plain headers when available — the `trusted-header` source can
  verify a JWT (`"jwtHeader": "authorization", "jwksUrl": …`).
- The app connects with an admin account: everything a user does is done as that account. The
  tracking feature (`pma__tracking`) and query history should record the **identity user** so
  actions stay attributable; add an audit log line per login (identity, server, IP).
- CSRF protection stays on (same-origin forms); the proxy's cookie and ours are separate.

## Implementation plan (if accepted)

1. Make `AuthPlugin.getCredentials` async; identity-keyed sessions without stored password.
2. `signon` plugin with the provider chain + `trusted-header` identity (+ optional JWT verify) and a
   `module` loader; unit tests with fake headers/peers.
3. `kubernetes-sar` authorizer (official `@kubernetes/client-node` or plain `fetch` with the
   in-cluster ServiceAccount token + CA) with caching; tests against a mocked API server.
4. Server providers: interface + `static` (current) + `kubernetes`; stable server ids; filtered by
   authorisation in login/switcher.
5. Attribute history/tracking/userprefs to the identity user; audit log.
6. Helm/Kustomize example: Deployment, ServiceAccount + RBAC, NetworkPolicy, oauth2-proxy ingress
   annotations; e2e with a fake proxy header and a mocked Kubernetes API (kind cluster optional).
