import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configSchema, type AppConfig } from '#lib/server/config/schema.ts';

let config: AppConfig;
const query = async () => [[], []];
const createConnection = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
	query,
	execute: query,
	end: async () => {}
}));
vi.mock('@sveltejs/kit/hooks', () => ({ sequence: (...hs: unknown[]) => hs[hs.length - 1] }));
vi.mock('#lib/server/config/index.ts', () => ({ getConfig: () => config }));
vi.mock('#lib/server/db/connection.ts', () => ({
	createConnection: (...args: unknown[]) => createConnection(...args)
}));
vi.mock('#lib/server/pmadb/tracking-hook.ts', () => ({ installTracking: () => null }));
vi.mock('#lib/server/preferences/store.ts', () => ({ loadPrefs: async () => ({ data: {} }) }));

const { handle } = await import('./hooks.server.ts');

/**
 * Fake Kubernetes API: namespaces `review-1` and `review-2`, each with a `mysql` Service and its
 * Secret; RBAC lets `alice` into review-1 and `carol` into review-2. `down` makes every call fail, `empty` lists no namespace, `secretMissing` answers 404 for the
 * Secret.
 */
const api = { down: false, empty: false, secretMissing: false, paths: [] as string[] };
let server: Server;
let dir: string;
let apiServer: string;
let tokenFile: string;

beforeAll(async () => {
	server = createServer((req, res) => {
		api.paths.push(req.url ?? '');
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			const send = (status: number, body: unknown) => {
				res.writeHead(status, { 'content-type': 'application/json' });
				res.end(JSON.stringify(body));
			};
			const url = req.url ?? '';
			if (api.down) return send(500, { kind: 'Status', message: 'down' });
			if (url.startsWith('/api/v1/namespaces?')) {
				const items = api.empty
					? []
					: ['review-1', 'review-2'].map((name) => ({ metadata: { name } }));
				return send(200, { items });
			}
			if (url.startsWith('/api/v1/services?')) {
				return send(200, {
					items: ['review-1', 'review-2'].map((namespace) => ({
						metadata: { name: 'mysql', namespace },
						spec: { ports: [{ name: 'mysql', port: 3306 }] }
					}))
				});
			}
			if (/^\/api\/v1\/namespaces\/review-[12]\/secrets\/mysql-auth$/.test(url)) {
				if (api.secretMissing) return send(404, { kind: 'Status', reason: 'NotFound' });
				return send(200, {
					data: { 'mysql-root-password': Buffer.from('from-secret').toString('base64') }
				});
			}
			if (url === '/apis/authorization.k8s.io/v1/subjectaccessreviews') {
				const review = JSON.parse(Buffer.concat(chunks).toString('utf8'));
				const { user, resourceAttributes } = review.spec;
				const allowed =
					(user === 'alice' && resourceAttributes.namespace === 'review-1') ||
					(user === 'carol' && resourceAttributes.namespace === 'review-2');
				return send(201, { status: { allowed } });
			}
			send(404, {});
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	apiServer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	dir = await mkdtemp(join(tmpdir(), 'sma-hook-discovery-'));
	tokenFile = join(dir, 'token');
	await writeFile(tokenFile, 'sa-token');
});

afterAll(async () => {
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
	await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
	// A new config object starts a new discovery (and empty caches).
	config = configSchema.parse({
		blowfish_secret: 'unit-test-secret-unit-test-secret-1234',
		Servers: [{ host: 'static.internal', auth_type: 'config', user: 'u', password: 'p' }],
		ServerDiscovery: {
			type: 'kubernetes',
			namespaceSelector: 'env=review',
			serviceSelector: 'app=mysql',
			secret: { name: 'mysql-auth', passwordKey: 'mysql-root-password' },
			authorize: { cacheSeconds: 0 },
			server: { Signon: { identity: { trustedProxies: ['10.0.0.1'] } } },
			apiServer,
			tokenFile
		}
	});
	Object.assign(api, { down: false, empty: false, secretMissing: false, paths: [] });
});

afterEach(() => {
	createConnection.mockClear();
	vi.restoreAllMocks();
});

function browser() {
	const jar = new Map<string, string>();
	return {
		jar,
		cookies: {
			get: (name: string) => jar.get(name),
			set: (name: string, value: string) => void jar.set(name, value),
			delete: (name: string) => void jar.delete(name)
		}
	};
}

async function get(path: string, user = 'alice', b = browser(), method = 'GET') {
	const url = new URL(`http://localhost${path}`);
	const event = {
		request: new Request(url, { method, headers: { 'x-auth-request-user': user } }),
		url,
		cookies: b.cookies,
		locals: {} as Record<string, unknown>,
		getClientAddress: () => '10.0.0.1'
	};
	const resolve = async (e: typeof event) => {
		if (e.locals.session) await e.locals.db;
		return new Response('page');
	};
	const res = await handle({ event, resolve } as never);
	return { res, locals: event.locals, browser: b };
}

describe('handle: Kubernetes server discovery', () => {
	it('connects to a discovered server with the account of its Secret, and remembers it', async () => {
		const { res, locals, browser: b } = await get('/?server=k8s:review-1/mysql');
		expect(res.status).toBe(200);
		expect(locals.serverId).toBe('k8s:review-1/mysql');
		expect(locals.session).toMatchObject({
			user: 'root',
			storageUser: 'alice',
			authType: 'signon'
		});
		expect(createConnection).toHaveBeenCalledWith(
			expect.objectContaining({ host: 'mysql.review-1.svc', port: 3306 }),
			'root',
			'from-secret',
			expect.anything()
		);
		expect(b.jar.get('sma_server')).toBe('k8s:review-1/mysql');

		// the next page, without ?server=, stays on that server
		const next = await get('/db/x/structure', 'alice', b);
		expect(next.locals.serverId).toBe('k8s:review-1/mysql');
	});

	it('checks RBAC in the namespace of the discovered server', async () => {
		const { res } = await get('/?server=k8s:review-1/mysql', 'bob');
		expect(res.status).toBe(403);
		expect(await res.text()).toBe(
			'You do not have access to this server (Kubernetes namespace review-1).'
		);
		expect(createConnection).not.toHaveBeenCalled();
	});

	it('keeps configured servers on their position', async () => {
		const { locals } = await get('/?server=1');
		expect(locals.serverId).toBe('1');
		expect(createConnection).toHaveBeenCalledWith(
			expect.objectContaining({ host: 'static.internal' }),
			'u',
			'p',
			expect.anything()
		);
		expect(api.paths.some((p) => p.includes('/secrets/'))).toBe(false);
	});

	it('falls back to the default server for an unknown id', async () => {
		const { locals, browser: b } = await get('/?server=k8s:review-9/mysql');
		expect(locals.serverId).toBe('1');
		expect(b.jar.has('sma_server')).toBe(false);
	});

	it('answers 503 when the servers cannot be listed, except the health check', async () => {
		api.down = true;
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { res } = await get('/');
		expect(res.status).toBe(503);
		expect(await res.text()).toBe('Cannot list the database servers right now.');

		const health = await get('/api/health');
		expect(health.res.status).toBe(200);
	});

	it('answers 503 without connecting when the Secret cannot be read', async () => {
		api.secretMissing = true;
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { res } = await get('/?server=k8s:review-1/mysql');
		expect(res.status).toBe(503);
		expect(await res.text()).toBe('Cannot read the account of this server right now.');
		expect(createConnection).not.toHaveBeenCalled();
		expect(String(error.mock.calls[0][1])).toMatch(/Secret review-1\/mysql-auth failed: HTTP 404/);
	});

	it('uses the first discovered server when none is configured', async () => {
		config = configSchema.parse({ ...config, Servers: [] });
		const { res, locals } = await get('/');
		expect(res.status).toBe(200);
		expect(locals.serverId).toBe('k8s:review-1/mysql');
	});

	it('answers 503 while discovery finds no server and none is configured', async () => {
		config = configSchema.parse({ ...config, Servers: [] });
		api.empty = true;
		const { res } = await get('/');
		expect(res.status).toBe(503);
		expect(await res.text()).toBe('No database server is available right now.');
	});

	describe('when nobody chose the server', () => {
		beforeEach(() => {
			config = configSchema.parse({ ...config, Servers: [] });
		});

		it('sends a person the default server refuses to the first one RBAC allows', async () => {
			const { res } = await get('/db/x/structure?pos=2', 'carol');
			expect(res.status).toBe(303);
			expect(res.headers.get('location')).toBe(
				'/db/x/structure?pos=2&server=k8s%3Areview-2%2Fmysql'
			);
			expect(createConnection).not.toHaveBeenCalled();
		});

		it('also when the remembered server is gone', async () => {
			const b = browser();
			b.jar.set('sma_server', 'k8s:review-9/mysql');
			const { res } = await get('/', 'carol', b);
			expect(res.headers.get('location')).toBe('/?server=k8s%3Areview-2%2Fmysql');
		});

		it('says so when RBAC allows the person nowhere', async () => {
			const { res } = await get('/', 'bob');
			expect(res.status).toBe(403);
			expect(await res.text()).toBe('You do not have access to any database server.');
		});

		it('does not redirect a POST', async () => {
			const { res } = await get('/', 'carol', browser(), 'POST');
			expect(res.status).toBe(403);
			expect(await res.text()).toBe(
				'You do not have access to this server (Kubernetes namespace review-1).'
			);
		});

		it('keeps the refusal when the person asked for that server', async () => {
			const { res } = await get('/?server=k8s:review-1/mysql', 'carol');
			expect(res.status).toBe(403);
			expect(await res.text()).toBe(
				'You do not have access to this server (Kubernetes namespace review-1).'
			);
		});
	});
});
