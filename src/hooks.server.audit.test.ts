import { afterEach, describe, expect, it, vi } from 'vitest';
import { configSchema } from '#lib/server/config/schema.ts';

const config = configSchema.parse({
	blowfish_secret: 'unit-test-secret-unit-test-secret-1234',
	AuditLog: { target: 'stdout' },
	Servers: [
		{
			host: 'db.internal',
			port: 3306,
			auth_type: 'signon',
			user: 'shared',
			password: 'pw',
			Signon: { identity: { type: 'trusted-header', trustedProxies: ['10.0.0.1'] } }
		}
	]
});

const query = async (sql: string) =>
	/^\s*select/i.test(sql) ? [[], []] : [{ affectedRows: 1 }, undefined];
vi.mock('@sveltejs/kit/hooks', () => ({ sequence: (...hs: unknown[]) => hs[hs.length - 1] }));
vi.mock('#lib/server/config/index.ts', () => ({ getConfig: () => config }));
vi.mock('#lib/server/db/connection.ts', () => ({
	createConnection: async () => ({ query, execute: query, end: async () => {} })
}));
vi.mock('#lib/server/preferences/store.ts', () => ({ loadPrefs: async () => ({ data: {} }) }));

const { handle } = await import('./hooks.server.ts');

function request(
	headers: Record<string, string>,
	peer: string,
	cookies = new Map<string, string>()
) {
	const url = new URL('http://localhost/db/sma_test/sql');
	return {
		request: new Request(url, { headers }),
		url,
		cookies: {
			get: (n: string) => cookies.get(n),
			set: (n: string, v: string) => void cookies.set(n, v),
			delete: (n: string) => void cookies.delete(n)
		},
		locals: {} as Record<string, unknown>,
		getClientAddress: () => peer
	};
}

function auditLines(out: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
	return out.mock.calls
		.map((c) => String(c[0]))
		.filter((l) => l.startsWith('{"ts"'))
		.map((l) => JSON.parse(l));
}

afterEach(() => vi.restoreAllMocks());

describe('handle: audit log', () => {
	it('a signon request logs the session, then the statement, as alice on the shared account', async () => {
		const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		const cookies = new Map<string, string>();
		const resolve = async (e: ReturnType<typeof request>) => {
			const conn = (await e.locals.db) as unknown as { query: typeof query };
			await conn.query('SELECT 1');
			await conn.query('INSERT INTO sma_test.t VALUES (1)');
			return new Response('ok');
		};
		const alice = { 'x-auth-request-user': 'alice', 'x-auth-request-email': 'alice@example.com' };
		await handle({ event: request(alice, '10.0.0.1', cookies), resolve } as never);
		// a second request of the same browser is not a new session
		await handle({ event: request(alice, '10.0.0.1', cookies), resolve } as never);

		const lines = auditLines(out);
		expect(lines.map((l) => l.event)).toEqual(['session', 'statement', 'statement']);
		expect(lines[0]).toMatchObject({
			identity: 'alice',
			mysqlUser: 'shared',
			email: 'alice@example.com',
			server: 'db.internal:3306',
			serverId: '1',
			clientIp: '10.0.0.1'
		});
		expect(lines[1]).toMatchObject({
			identity: 'alice',
			mysqlUser: 'shared',
			sql: 'INSERT INTO sma_test.t VALUES (1)',
			ok: true,
			affectedRows: 1
		});
	});

	it('an identity header from an untrusted peer is logged as denied, without an identity', async () => {
		const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		const resolve = async () => new Response('ok');
		const res = await handle({
			event: request({ 'x-auth-request-user': 'admin' }, '198.51.100.9'),
			resolve
		} as never);
		expect(res.status).toBe(401);
		expect(auditLines(out)).toMatchObject([
			{
				event: 'denied',
				identity: null,
				mysqlUser: null,
				claimedUser: 'admin',
				reason: 'untrusted-proxy',
				clientIp: '198.51.100.9'
			}
		]);
	});

	it('anonymous requests without an identity claim are not logged', async () => {
		const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		await handle({
			event: request({}, '198.51.100.9'),
			resolve: async () => new Response('')
		} as never);
		expect(auditLines(out)).toEqual([]);
	});
});
