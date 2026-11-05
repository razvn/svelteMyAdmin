/**
 * `ServerDiscovery: { type: "kubernetes" }`: the MySQL Services of labelled namespaces become signon
 * servers, connecting with an account read from a Secret of the namespace. See docs/SIGNON.md,
 * "Server discovery".
 */
import { z } from 'zod';
import { serverSchema, type ServerConfig, type ServerDiscoveryConfig } from '../config/schema';
import { kubernetesRequest, type KubernetesAccess } from '../kubernetes/client.ts';

export interface NamespaceInfo {
	name: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
}

export interface ServiceInfo {
	name: string;
	namespace: string;
	ports: { name?: string; port: number }[];
}

export interface Account {
	user: string;
	password: string;
}

const metadata = z.object({
	name: z.string(),
	namespace: z.string().optional(),
	labels: z.record(z.string(), z.string()).nullish(),
	annotations: z.record(z.string(), z.string()).nullish()
});
const listOf = <T extends z.ZodType>(item: T) =>
	z.object({
		items: z.array(item).nullish(),
		metadata: z.object({ continue: z.string().optional() }).optional()
	});
const namespaceList = listOf(z.object({ metadata }));
const serviceList = listOf(
	z.object({
		metadata,
		spec: z
			.object({
				ports: z.array(z.object({ name: z.string().optional(), port: z.number().int() })).nullish()
			})
			.optional()
	})
);
const secretSchema = z.object({ data: z.record(z.string(), z.string()).nullish() });

/** Fill `{namespace}`, `{service}`, `{label:key}`, `{annotation:key}` (labels and annotations of the namespace). */
export function fillTemplate(template: string, ns: NamespaceInfo, service: string): string {
	return template.replace(
		/\{(namespace|service|label:[^{}]+|annotation:[^{}]+)\}/g,
		(_, key: string) => {
			if (key === 'namespace') return ns.name;
			if (key === 'service') return service;
			if (key.startsWith('label:')) return ns.labels[key.slice(6)] ?? '';
			return ns.annotations[key.slice(11)] ?? '';
		}
	);
}

/** The port to connect to: the one named (or numbered) `wanted`, else the only one. */
export function servicePort(ports: ServiceInfo['ports'], wanted: string | number): number | null {
	if (typeof wanted === 'number') return ports.some((p) => p.port === wanted) ? wanted : null;
	const named = ports.find((p) => p.name === wanted);
	if (named) return named.port;
	return ports.length === 1 ? ports[0].port : null;
}

export const serverId = (namespace: string, service: string) => `k8s:${namespace}/${service}`;

/** The server definition of one Service (no account yet: see `credentials`). */
export function discoveredServer(
	ns: NamespaceInfo,
	svc: ServiceInfo,
	cfg: ServerDiscoveryConfig,
	sqliteStorage?: string
): ServerConfig | null {
	const port = servicePort(svc.ports, cfg.port);
	if (port === null) return null;
	const server: ServerConfig = serverSchema.parse({
		...cfg.server,
		auth_type: 'signon',
		host: fillTemplate(cfg.host, ns, svc.name),
		port,
		verbose: fillTemplate(cfg.verbose, ns, svc.name).trim() || `${ns.name}/${svc.name}`,
		user: '',
		password: ''
	});
	if (cfg.authorize !== false && server.Signon) {
		server.Signon = {
			...server.Signon,
			authorize: {
				...cfg.authorize,
				namespace: ns.name,
				apiServer: cfg.apiServer,
				tokenFile: cfg.tokenFile,
				caFile: cfg.caFile
			}
		};
	}
	if (sqliteStorage && !server.pmadb && server.ConfigStorage !== false) {
		server.sqlite_storage = sqliteStorage;
	}
	server.discovered = { id: serverId(ns.name, svc.name), namespace: ns.name, service: svc.name };
	return server;
}

/** Servers of the matching Services in the matching namespaces, sorted by namespace and Service. */
export function toServers(
	namespaces: NamespaceInfo[],
	services: ServiceInfo[],
	cfg: ServerDiscoveryConfig,
	sqliteStorage?: string
): ServerConfig[] {
	const byName = new Map(namespaces.map((ns) => [ns.name, ns]));
	const out: ServerConfig[] = [];
	for (const svc of services) {
		const ns = byName.get(svc.namespace);
		if (!ns) continue;
		const server = discoveredServer(ns, svc, cfg, sqliteStorage);
		if (server) out.push(server);
	}
	return out.sort((a, b) => (a.discovered!.id < b.discovered!.id ? -1 : 1));
}

type Request = typeof kubernetesRequest;

export interface DiscoveryOptions {
	timeoutMs?: number;
	/** Clock of the caches, in milliseconds. */
	now?: () => number;
	request?: Request;
	/** Where refresh failures are reported (the previous list stays in use). */
	log?: (message: string, error: unknown) => void;
}

export interface Discovery {
	/** The current list. The first call waits for it; later ones refresh in the background. */
	servers(): Promise<ServerConfig[]>;
	/** The account of a discovered server, from its Secret (cached like the list). */
	credentials(server: ServerConfig): Promise<Account>;
}

async function listAll<T>(
	access: KubernetesAccess,
	what: string,
	path: string,
	schema: z.ZodType<{ items?: T[] | null; metadata?: { continue?: string } }>,
	request: Request,
	timeoutMs: number
): Promise<T[]> {
	const items: T[] = [];
	let token: string | undefined;
	do {
		const url = path + `&limit=500${token ? `&continue=${encodeURIComponent(token)}` : ''}`;
		const parsed = schema.safeParse(await request(access, what, 'GET', url, undefined, timeoutMs));
		if (!parsed.success) throw new Error(`${what} response is not a list`);
		items.push(...(parsed.data.items ?? []));
		token = parsed.data.metadata?.continue || undefined;
	} while (token);
	return items;
}

const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;

export function createDiscovery(
	cfg: ServerDiscoveryConfig,
	sqliteStorage: string | undefined,
	{
		timeoutMs = 5000,
		now = Date.now,
		request = kubernetesRequest,
		log = (m, e) => console.error(m, e)
	}: DiscoveryOptions = {}
): Discovery {
	const ttl = cfg.refreshSeconds * 1000;
	let list: ServerConfig[] | undefined;
	let fetchedAt = 0;
	let refreshing: Promise<ServerConfig[]> | undefined;
	const secrets = new Map<string, { account: Promise<Account>; expiresAt: number }>();

	async function load(): Promise<ServerConfig[]> {
		const selector = (s: string) => `?labelSelector=${encodeURIComponent(s)}`;
		const [nsItems, svcItems] = await Promise.all([
			listAll(
				cfg,
				'Namespace list',
				'/api/v1/namespaces' + selector(cfg.namespaceSelector),
				namespaceList,
				request,
				timeoutMs
			),
			listAll(
				cfg,
				'Service list',
				'/api/v1/services' + selector(cfg.serviceSelector),
				serviceList,
				request,
				timeoutMs
			)
		]);
		const namespaces = nsItems.map(({ metadata: m }) => ({
			name: m.name,
			labels: m.labels ?? {},
			annotations: m.annotations ?? {}
		}));
		const services = svcItems.flatMap(({ metadata: m, spec }) =>
			m.namespace ? [{ name: m.name, namespace: m.namespace, ports: spec?.ports ?? [] }] : []
		);
		return toServers(namespaces, services, cfg, sqliteStorage);
	}

	function refresh(): Promise<ServerConfig[]> {
		refreshing ??= load()
			.then((found) => {
				list = found;
				const ids = new Set(found.map((s) => s.discovered!.id));
				for (const id of secrets.keys()) if (!ids.has(id)) secrets.delete(id);
				return found;
			})
			.finally(() => {
				fetchedAt = now();
				refreshing = undefined;
			});
		return refreshing;
	}

	return {
		async servers() {
			if (list === undefined) return refresh();
			if (now() - fetchedAt >= ttl) {
				// Stale: answer with the current list, refresh for the next requests.
				refresh().catch((e) => log('[discovery] cannot refresh the server list:', e));
			}
			return list;
		},

		credentials(server) {
			const ref = server.discovered;
			if (!ref) return Promise.reject(new Error('not a discovered server'));
			const hit = secrets.get(ref.id);
			if (hit && now() < hit.expiresAt) return hit.account;

			const ns: NamespaceInfo = { name: ref.namespace, labels: {}, annotations: {} };
			const name = fillTemplate(cfg.secret.name, ns, ref.service);
			const account = (async (): Promise<Account> => {
				if (!DNS_SUBDOMAIN.test(name)) throw new Error(`invalid Secret name "${name}"`);
				const what = `Secret ${ref.namespace}/${name}`;
				const path = `/api/v1/namespaces/${encodeURIComponent(ref.namespace)}/secrets/${name}`;
				const parsed = secretSchema.safeParse(
					await request(cfg, what, 'GET', path, undefined, timeoutMs)
				);
				const data = parsed.success ? (parsed.data.data ?? {}) : {};
				const read = (key: string) => {
					const value = data[key];
					if (value === undefined) throw new Error(`${what} has no key "${key}"`);
					return Buffer.from(value, 'base64').toString('utf8');
				};
				return {
					user: cfg.secret.userKey ? read(cfg.secret.userKey) : cfg.secret.user,
					password: read(cfg.secret.passwordKey)
				};
			})();
			const entry = { account, expiresAt: Infinity };
			secrets.set(ref.id, entry);
			account.then(
				() => (entry.expiresAt = now() + ttl),
				() => {
					if (secrets.get(ref.id) === entry) secrets.delete(ref.id);
				}
			);
			return account;
		}
	};
}
