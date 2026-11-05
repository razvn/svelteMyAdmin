# Kubernetes example

svelteMyAdmin finds the MySQL server of every review namespace (one per merge request), connects with the
account from that namespace's Secret, and lets Kubernetes RBAC decide who may use which one. The full
reference is in [docs/SIGNON.md](../../docs/SIGNON.md) ("Kubernetes RBAC" and "Server discovery").

| File                  | What                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `sveltemyadmin.yaml`  | The app in namespace `tools`: ServiceAccount, RBAC for SubjectAccessReviews and discovery, config, Deployment, ClusterIP Service. |
| `review-example.yaml` | Two review environments (`review-1` with MySQL 8.4, `review-2` with MariaDB 11.4), a decoy namespace, and who may use what.       |

The example config trusts identity headers from `127.0.0.1` / `::1` only, which is what `kubectl
port-forward` looks like from inside the pod. That makes it a local try-out. For real use, see
[Going to production](#going-to-production).

## Try it on a local cluster

Rancher Desktop with the `moby` engine, or any cluster that can run an image you built locally. Run the
commands from the repository root.

```bash
docker build -t sveltemyadmin:dev .
```

```bash
kubectl apply -f deploy/kubernetes/sveltemyadmin.yaml -f deploy/kubernetes/review-example.yaml
```

```bash
kubectl -n tools rollout status deploy/sveltemyadmin
```

```bash
kubectl -n tools port-forward deploy/sveltemyadmin 8080:3000
```

The SSO proxy is played by request headers. `X-Forwarded-Proto: http` is needed because the
Deployment sets `PROTOCOL_HEADER` (a real proxy terminating TLS sends `https`).

```bash
curl -i -H 'X-Auth-Request-User: carol' -H 'X-Forwarded-Proto: http' http://localhost:8080/
```

What to expect, with the RoleBindings of `review-example.yaml`:

| Who                                                    | Gets                                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `alice`, group `team-a`                                | `review-1` (MySQL, database `shop`); the switcher lists only `review-1`.            |
| `carol`                                                | Redirected from the default `review-1` to `review-2` (MariaDB, database `reports`). |
| `bob`, group `team-b`                                  | `403 You do not have access to any database server.`                                |
| Anyone, `?server=k8s:review-1/mysql` without the right | `403 You do not have access to this server (Kubernetes namespace review-1).`        |
| No user header                                         | `401 Authentication required.`                                                      |

Send groups with `-H 'X-Auth-Request-Groups: team-a'`. In a browser, a header extension (ModHeader,
for example) sets the same headers.

Check what RBAC says on its own:

```bash
kubectl auth can-i get pods -n review-1 --as oidc:alice --as-group oidc:team-a
```

The audit log goes to the pod's stdout, one JSON line per event:

```bash
kubectl -n tools logs deploy/sveltemyadmin
```

Clean up:

```bash
kubectl delete -f deploy/kubernetes/review-example.yaml -f deploy/kubernetes/sveltemyadmin.yaml
```

## Going to production

- **Put a real SSO proxy in front.** oauth2-proxy, an ingress `auth-url`, Pomerium... (see "Proxy
  setups" in docs/SIGNON.md). Set `trustedProxies` to the proxy's pod addresses, and add a
  NetworkPolicy so only the proxy can reach the app.
- **Match the cluster's OIDC names.** `authorize.userPrefix` and `groupsPrefix` must equal the API
  server's `--oidc-username-prefix` and `--oidc-groups-prefix`. Otherwise RBAC denies everyone.
- **Keep secrets out of the ConfigMap.** Mount the config from a Secret, with a random
  `blowfish_secret` of 32 characters or more.
- **Use your registry.** Push the image there, and drop `imagePullPolicy: Never`.
- **Narrow the Secret right if needed.** The ClusterRoleBinding lets the app read `mysql-auth` in every
  namespace. Bind `sveltemyadmin-discovery` with a RoleBinding per review namespace instead, from the
  pipeline that creates it, to narrow that down.
- **Keep the database out of the app's namespace.** It also holds the configuration storage (`pmadb`).
  Keep the audit log store outside the namespaces of the people it records.
