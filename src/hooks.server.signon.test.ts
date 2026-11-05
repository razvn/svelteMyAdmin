import { describe, expect, it, vi } from 'vitest';
import { configSchema } from '#lib/server/config/schema.ts';

const config = configSchema.parse({
	blowfish_secret: 'unit-test-secret-unit-test-secret-1234',
	Servers: [
		{
			host: '127.0.0.1',
			auth_type: 'signon',
			user: 'shared',
			password: 'pw',
			Signon: { identity: { type: 'trusted-header', trustedProxies: ['10.0.0.1'] } }
		}
	]
});

const createConnection = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
	end: async () => {}
}));
const installTracking = vi.fn<(...args: unknown[]) => null>(() => null);
vi.mock('@sveltejs/kit/hooks', () => ({ sequence: (...hs: unknown[]) => hs[hs.length - 1] }));
vi.mock('#lib/server/config/index.ts', () => ({ getConfig: () => config }));
vi.mock('#lib/server/db/connection.ts', () => ({
	createConnection: (...args: unknown[]) => createConnection(...args)
}));
vi.mock('#lib/server/pmadb/tracking-hook.ts', () => ({
	installTracking: (...args: unknown[]) => installTracking(...args)
}));

const { handle } = await import('./hooks.server.ts');

describe('handle: signon', () => {
	it('connects as the shared account and attributes tracked changes to the identity', async () => {
		const url = new URL('http://localhost/db/sma_test/structure');
		const event = {
			request: new Request(url, { headers: { 'x-auth-request-user': 'alice' } }),
			url,
			cookies: { get: () => undefined, set: () => {}, delete: () => {} },
			locals: {} as Record<string, unknown>,
			getClientAddress: () => '10.0.0.1'
		};
		const resolve = async (e: typeof event) => {
			await e.locals.db;
			return new Response('ok');
		};
		await handle({ event, resolve } as never);

		expect(createConnection.mock.calls[0].slice(0, 3)).toMatchObject([
			expect.anything(),
			'shared',
			'pw'
		]);
		expect(installTracking.mock.calls[0][2]).toBe('alice');
		expect(event.locals.session).toMatchObject({ user: 'shared', storageUser: 'alice' });
	});
});
