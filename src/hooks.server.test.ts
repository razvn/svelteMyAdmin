import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configSchema } from '#lib/server/config/schema.ts';
import { setSessionCookie } from '#lib/server/auth/plugins/cookie.ts';
import { SESSION_COOKIE } from '#lib/server/auth/session.ts';

const config = configSchema.parse({
	blowfish_secret: 'unit-test-secret-unit-test-secret-1234',
	Servers: [{ host: '127.0.0.1', port: 33306, auth_type: 'cookie', AllowRoot: true }],
	DefaultConnectionCollation: 'utf8mb4_unicode_ci'
});

const createConnection = vi.fn();
// `sequence` needs Kit's request store; the auth handle is the last one and what we test.
vi.mock('@sveltejs/kit/hooks', () => ({ sequence: (...hs: unknown[]) => hs[hs.length - 1] }));
vi.mock('#lib/server/config/index.ts', () => ({ getConfig: () => config }));
vi.mock('#lib/server/db/connection.ts', () => ({
	createConnection: (...args: unknown[]) => createConnection(...args)
}));

const { handle } = await import('./hooks.server.ts');

function fakeCookies() {
	const jar = new Map<string, string>();
	return {
		jar,
		get: (n: string) => jar.get(n),
		set: vi.fn((n: string, v: string) => void jar.set(n, v)),
		delete: vi.fn((n: string) => void jar.delete(n))
	};
}

function makeEvent(path = '/db/sma_test/structure') {
	const cookies = fakeCookies();
	const url = new URL(`http://localhost${path}`);
	setSessionCookie(cookies as never, config, url, {
		serverIndex: 1,
		user: 'root',
		password: 'old-password'
	});
	const event = {
		request: new Request(url),
		url,
		cookies,
		locals: {} as Record<string, unknown>,
		getClientAddress: () => '127.0.0.1'
	};
	return { event, cookies };
}

const resolve = async (event: { locals: Record<string, unknown> }) => {
	await event.locals.db;
	return new Response('ok');
};

describe('handle: rejected cookie-session credentials', () => {
	beforeEach(() => {
		createConnection.mockReset();
	});

	it('clears the session cookie and redirects to /login?expired=1', async () => {
		const denied = Object.assign(new Error('denied'), { errno: 1045 });
		createConnection.mockImplementation(async () => {
			throw denied;
		});
		const { event, cookies } = makeEvent();
		const err = await Promise.resolve(handle({ event, resolve } as never)).catch((e: unknown) => e);
		expect(err).toMatchObject({
			status: 303,
			location: '/login?expired=1&redirect=%2Fdb%2Fsma_test%2Fstructure'
		});
		expect(cookies.delete).toHaveBeenCalledWith(SESSION_COOKIE, expect.anything());
		expect(cookies.jar.has(SESSION_COOKIE)).toBe(false);
	});

	it('lets other connection errors through', async () => {
		const down = Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
		createConnection.mockImplementation(async () => {
			throw down;
		});
		const { event, cookies } = makeEvent();
		await expect(Promise.resolve(handle({ event, resolve } as never))).rejects.toBe(down);
		expect(cookies.delete).not.toHaveBeenCalled();
	});

	it('passes the connection collation (cookie, else DefaultConnectionCollation)', async () => {
		createConnection.mockResolvedValue({ end: async () => {} });
		const { event, cookies } = makeEvent();
		await handle({ event, resolve } as never);
		expect(createConnection.mock.calls[0][3]).toEqual({ collation: 'utf8mb4_unicode_ci' });

		createConnection.mockClear();
		const second = makeEvent();
		second.cookies.jar.set('sma_collation', 'utf8mb4_general_ci');
		await handle({ event: second.event, resolve } as never);
		expect(createConnection.mock.calls[0][3]).toEqual({ collation: 'utf8mb4_general_ci' });
		expect(cookies).toBeDefined();
	});
});
