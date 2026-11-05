import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

/** Fake Kubernetes API: allows `alice` only; `status` 500 simulates a broken API server. */
let apiStatus = 201;
let api: Server;
let dir: string;

beforeAll(async () => {
	api = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			const review = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			res.writeHead(apiStatus, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ status: { allowed: review.spec.user === 'alice' } }));
		});
	});
	await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
	dir = await mkdtemp(join(tmpdir(), 'sma-hook-sar-'));
	const tokenFile = join(dir, 'token');
	await writeFile(tokenFile, 'sa-token');
	config = configSchema.parse({
		blowfish_secret: 'unit-test-secret-unit-test-secret-1234',
		AuditLog: { target: 'stdout' },
		Servers: [
			{
				host: 'db.internal',
				auth_type: 'signon',
				user: 'shared',
				password: 'pw',
				Signon: {
					identity: { trustedProxies: ['10.0.0.1'] },
					authorize: {
						type: 'kubernetes-sar',
						namespace: 'review-123',
						cacheSeconds: 0,
						apiServer: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
						tokenFile
					}
				}
			}
		]
	});
});

afterAll(async () => {
	api.closeAllConnections();
	await new Promise((resolve) => api.close(resolve));
	await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
	apiStatus = 201;
	createConnection.mockClear();
	vi.restoreAllMocks();
});

async function get(user: string, path = '/db/sma_test/structure') {
	const url = new URL(`http://localhost${path}`);
	const event = {
		request: new Request(url, { headers: { 'x-auth-request-user': user } }),
		url,
		cookies: { get: () => undefined, set: () => {}, delete: () => {} },
		locals: {} as Record<string, unknown>,
		getClientAddress: () => '10.0.0.1'
	};
	const resolve = async (e: typeof event) => {
		if (e.locals.session) await e.locals.db;
		return new Response('page');
	};
	const res = await handle({ event, resolve } as never);
	return { res, locals: event.locals };
}

function auditLines(out: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
	return out.mock.calls
		.map((c) => String(c[0]))
		.filter((l) => l.startsWith('{"ts"'))
		.map((l) => JSON.parse(l));
}

describe('handle: signon with Kubernetes RBAC', () => {
	it('lets a person RBAC allows in, connected as the shared account', async () => {
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		const { res, locals } = await get('alice');
		expect(res.status).toBe(200);
		expect(locals.session).toMatchObject({ user: 'shared', storageUser: 'alice' });
		expect(createConnection).toHaveBeenCalledOnce();
	});

	it('refuses a person RBAC denies, without opening a connection, and audits it', async () => {
		const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		const { res, locals } = await get('mallory');
		expect(res.status).toBe(403);
		expect(await res.text()).toBe(
			'You do not have access to this server (Kubernetes namespace review-123).'
		);
		expect(locals.session).toBeNull();
		expect(createConnection).not.toHaveBeenCalled();
		expect(auditLines(out)).toEqual([
			expect.objectContaining({
				event: 'denied',
				reason: 'not-authorized',
				claimedUser: 'mallory',
				identity: null,
				mysqlUser: null
			})
		]);
	});

	it('renders public pages for a denied person as if signed out', async () => {
		const { res, locals } = await get('mallory', '/login');
		expect(res.status).toBe(200);
		expect(locals.session).toBeNull();
		expect(createConnection).not.toHaveBeenCalled();
	});

	it('fails closed with 503 when the API server cannot answer', async () => {
		const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		apiStatus = 500;
		const { res, locals } = await get('alice');
		expect(res.status).toBe(503);
		expect(await res.text()).toBe('Cannot verify your access right now.');
		expect(locals.session).toBeNull();
		expect(createConnection).not.toHaveBeenCalled();
		expect(err).toHaveBeenCalled();
		expect(String(err.mock.calls[0])).not.toContain('sa-token');
		expect(auditLines(out)).toEqual([
			expect.objectContaining({
				event: 'denied',
				reason: 'authorization-error',
				claimedUser: 'alice'
			})
		]);
	});
});
