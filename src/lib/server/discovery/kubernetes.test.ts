import { describe, expect, it, vi } from 'vitest';
import { serverDiscoverySchema, type ServerDiscoveryConfig } from '#lib/server/config/schema.ts';
import {
	createDiscovery,
	fillTemplate,
	servicePort,
	toServers,
	type NamespaceInfo,
	type ServiceInfo
} from './kubernetes.ts';

const identity = { trustedProxies: ['10.0.0.1'] };

function discoveryConfig(extra: Record<string, unknown> = {}): ServerDiscoveryConfig {
	return serverDiscoverySchema.parse({
		type: 'kubernetes',
		namespaceSelector: 'env=review',
		serviceSelector: 'app=mysql',
		secret: { name: 'mysql-auth', passwordKey: 'root-password' },
		server: { Signon: { identity }, pmadb: 'phpmyadmin' },
		apiServer: 'https://k8s.test',
		...extra
	});
}

const review1: NamespaceInfo = {
	name: 'review-1',
	labels: { env: 'review', mr: '17' },
	annotations: { 'gitlab.com/mr-title': 'Fix login' }
};
const review2: NamespaceInfo = { name: 'review-2', labels: {}, annotations: {} };
const mysql = (
	namespace: string,
	ports: ServiceInfo['ports'] = [{ name: 'mysql', port: 3306 }]
) => ({
	name: 'mysql',
	namespace,
	ports
});

describe('fillTemplate', () => {
	it('fills the namespace, Service, labels and annotations of the namespace', () => {
		expect(
			fillTemplate(
				'{namespace}/{service} !{label:mr} {annotation:gitlab.com/mr-title}{label:missing}',
				review1,
				'mysql'
			)
		).toBe('review-1/mysql !17 Fix login');
	});
});

describe('servicePort', () => {
	const ports = [
		{ name: 'mysql', port: 3306 },
		{ name: 'metrics', port: 9104 }
	];
	it('takes the named port', () => expect(servicePort(ports, 'metrics')).toBe(9104));
	it('takes a numbered port only when the Service has it', () => {
		expect(servicePort(ports, 3306)).toBe(3306);
		expect(servicePort(ports, 3307)).toBeNull();
	});
	it('falls back to the only port, else none', () => {
		expect(servicePort([{ port: 3307 }], 'mysql')).toBe(3307);
		expect(servicePort(ports, 'db')).toBeNull();
	});
});

describe('toServers', () => {
	it('makes a signon server per Service, with the RBAC check in its own namespace', () => {
		const [server] = toServers([review1], [mysql('review-1')], discoveryConfig());
		expect(server).toMatchObject({
			auth_type: 'signon',
			host: 'mysql.review-1.svc',
			port: 3306,
			verbose: 'review-1',
			pmadb: 'phpmyadmin',
			user: '',
			password: '',
			discovered: { id: 'k8s:review-1/mysql', namespace: 'review-1', service: 'mysql' },
			Signon: {
				identity: { trustedProxies: ['10.0.0.1'] },
				authorize: {
					type: 'kubernetes-sar',
					namespace: 'review-1',
					resource: { group: '', resource: 'pods', verb: 'get' },
					apiServer: 'https://k8s.test'
				}
			}
		});
	});

	it('leaves the RBAC check out with authorize: false', () => {
		const [server] = toServers(
			[review1],
			[mysql('review-1')],
			discoveryConfig({ authorize: false })
		);
		expect(server.Signon?.authorize).toBeUndefined();
	});

	it('skips Services outside the matching namespaces or without a usable port, and sorts by id', () => {
		const servers = toServers(
			[review2, review1],
			[
				mysql('review-2'),
				mysql('other'),
				{ name: 'db', namespace: 'review-1', ports: [{ port: 1 }, { port: 2 }] },
				mysql('review-1')
			],
			discoveryConfig()
		);
		expect(servers.map((s) => s.discovered?.id)).toEqual([
			'k8s:review-1/mysql',
			'k8s:review-2/mysql'
		]);
	});

	it('uses the label template, falling back to namespace/service when it is blank', () => {
		const cfg = discoveryConfig({ verbose: '{annotation:gitlab.com/mr-title}' });
		const [a, b] = toServers([review1, review2], [mysql('review-1'), mysql('review-2')], cfg);
		expect([a.verbose, b.verbose]).toEqual(['Fix login', 'review-2/mysql']);
	});

	it('gives servers without pmadb the SQLite configuration storage', () => {
		const cfg = discoveryConfig({ server: { Signon: { identity } } });
		const [server] = toServers([review1], [mysql('review-1')], cfg, '/data/storage.sqlite');
		expect(server.sqlite_storage).toBe('/data/storage.sqlite');
	});
});

/** A fake API: namespaces, services and secrets by path. */
function fakeApi(state: {
	namespaces: NamespaceInfo[];
	services: ServiceInfo[];
	secrets?: Record<string, Record<string, string>>;
	fail?: boolean;
}) {
	return vi.fn(async (_access: unknown, what: string, _method: string, path: string) => {
		if (state.fail) throw new Error(`${what} failed: HTTP 500`);
		if (path.startsWith('/api/v1/namespaces?')) {
			return {
				items: state.namespaces.map((n) => ({
					metadata: { name: n.name, labels: n.labels, annotations: n.annotations }
				}))
			};
		}
		if (path.startsWith('/api/v1/services?')) {
			return {
				items: state.services.map((s) => ({
					metadata: { name: s.name, namespace: s.namespace },
					spec: { ports: s.ports }
				}))
			};
		}
		const secret = /^\/api\/v1\/namespaces\/([^/]+)\/secrets\/([^/]+)$/.exec(path);
		if (secret) {
			const data = state.secrets?.[`${secret[1]}/${secret[2]}`];
			if (!data) throw new Error(`${what} failed: HTTP 404`);
			return {
				data: Object.fromEntries(
					Object.entries(data).map(([k, v]) => [k, Buffer.from(v).toString('base64')])
				)
			};
		}
		throw new Error(`unexpected ${path}`);
	});
}

describe('createDiscovery', () => {
	const setup = (state: Parameters<typeof fakeApi>[0], extra: Record<string, unknown> = {}) => {
		let time = 0;
		const request = fakeApi(state);
		const log = vi.fn();
		const discovery = createDiscovery(discoveryConfig(extra), undefined, {
			request: request as never,
			now: () => time,
			log
		});
		return { discovery, request, log, tick: (ms: number) => (time += ms) };
	};
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

	it('lists namespaces and Services by label selector', async () => {
		const { discovery, request } = setup({ namespaces: [review1], services: [mysql('review-1')] });
		const servers = await discovery.servers();
		expect(servers.map((s) => s.discovered?.id)).toEqual(['k8s:review-1/mysql']);
		expect(request.mock.calls.map((c) => c[3])).toEqual([
			'/api/v1/namespaces?labelSelector=env%3Dreview&limit=500',
			'/api/v1/services?labelSelector=app%3Dmysql&limit=500'
		]);
	});

	it('follows continue tokens', async () => {
		const request = vi.fn(async (_a: unknown, _w: string, _m: string, path: string) => {
			if (path.startsWith('/api/v1/services')) return { items: [] };
			return path.includes('continue=next')
				? { items: [{ metadata: { name: 'review-2' } }] }
				: { items: [{ metadata: { name: 'review-1' } }], metadata: { continue: 'next' } };
		});
		const discovery = createDiscovery(discoveryConfig(), undefined, { request: request as never });
		await discovery.servers();
		expect(request.mock.calls.map((c) => c[3])).toContain(
			'/api/v1/namespaces?labelSelector=env%3Dreview&limit=500&continue=next'
		);
	});

	it('reuses the list for refreshSeconds, then refreshes in the background', async () => {
		const state = { namespaces: [review1], services: [mysql('review-1')] };
		const { discovery, request, tick } = setup(state);
		await discovery.servers();
		tick(29_000);
		await discovery.servers();
		expect(request).toHaveBeenCalledTimes(2);

		state.namespaces = [review1, review2];
		state.services = [mysql('review-1'), mysql('review-2')];
		tick(1000);
		// stale: answered from the old list while the new one loads
		expect(await discovery.servers()).toHaveLength(1);
		await flush();
		expect(await discovery.servers()).toHaveLength(2);
		expect(request).toHaveBeenCalledTimes(4);
	});

	it('fails the first listing, but keeps the previous list when a refresh fails', async () => {
		const state = { namespaces: [review1], services: [mysql('review-1')], fail: true };
		const { discovery, log, tick } = setup(state);
		await expect(discovery.servers()).rejects.toThrow(/HTTP 500/);

		state.fail = false;
		expect(await discovery.servers()).toHaveLength(1);
		state.fail = true;
		tick(30_000);
		expect(await discovery.servers()).toHaveLength(1);
		await flush();
		expect(await discovery.servers()).toHaveLength(1);
		expect(log).toHaveBeenCalledWith(
			'[discovery] cannot refresh the server list:',
			expect.any(Error)
		);
	});

	it('reads the account from the Secret of the namespace and caches it', async () => {
		const { discovery, request } = setup({
			namespaces: [review1],
			services: [mysql('review-1')],
			secrets: { 'review-1/mysql-auth': { 'root-password': 's3cret' } }
		});
		const [server] = await discovery.servers();
		expect(await discovery.credentials(server)).toEqual({ user: 'root', password: 's3cret' });
		await discovery.credentials(server);
		expect(request.mock.calls.filter((c) => String(c[3]).includes('/secrets/'))).toHaveLength(1);
	});

	it('reads the user from the Secret with userKey, and fills the Secret name template', async () => {
		const { discovery } = setup(
			{
				namespaces: [review1],
				services: [mysql('review-1')],
				secrets: { 'review-1/mysql-admin': { username: 'admin', password: 'pw' } }
			},
			{ secret: { name: '{service}-admin', userKey: 'username', passwordKey: 'password' } }
		);
		const [server] = await discovery.servers();
		expect(await discovery.credentials(server)).toEqual({ user: 'admin', password: 'pw' });
	});

	it('does not cache a missing Secret or key', async () => {
		const state = {
			namespaces: [review1],
			services: [mysql('review-1')],
			secrets: { 'review-1/mysql-auth': { other: 'x' } } as Record<string, Record<string, string>>
		};
		const { discovery } = setup(state);
		const [server] = await discovery.servers();
		await expect(discovery.credentials(server)).rejects.toThrow(
			'Secret review-1/mysql-auth has no key "root-password"'
		);
		state.secrets['review-1/mysql-auth'] = { 'root-password': 'late' };
		expect(await discovery.credentials(server)).toMatchObject({ password: 'late' });
	});

	it('refuses a Secret name that is not a Kubernetes name', async () => {
		const { discovery, request } = setup(
			{ namespaces: [review1], services: [mysql('review-1')] },
			{ secret: { name: '{annotation:x}', passwordKey: 'p' } }
		);
		const [server] = await discovery.servers();
		await expect(discovery.credentials(server)).rejects.toThrow(/invalid Secret name/);
		expect(request.mock.calls.some((c) => String(c[3]).includes('/secrets/'))).toBe(false);
	});
});
