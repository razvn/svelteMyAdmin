import { describe, expect, it, vi } from 'vitest';
import { configSchema, type AppConfig } from '#lib/server/config/schema.ts';
import type { Identity } from '#lib/server/auth/plugins/types.ts';
import { discoveryFor, findServerIndex, requestConfig, serverKey, withAccount } from './index.ts';
import { firstAllowedServer, switchableServers } from './switchable.ts';

const identity = { trustedProxies: ['10.0.0.1'] };

function baseConfig(extra: Record<string, unknown> = {}): AppConfig {
	return configSchema.parse({
		Servers: [{ host: 'static-1' }, { host: 'static-2', auth_type: 'config' }],
		ServerDiscovery: {
			type: 'kubernetes',
			namespaceSelector: 'env=review',
			serviceSelector: 'app=mysql',
			secret: { name: 'mysql-auth', passwordKey: 'root-password' },
			server: { Signon: { identity } },
			apiServer: 'https://k8s.test'
		},
		...extra
	});
}

/** Fake API with `review-1` and `review-2`, each with a `mysql` Service and Secret. */
function fakeRequest() {
	return vi.fn(async (_a: unknown, _what: string, _m: string, path: string) => {
		if (path.startsWith('/api/v1/namespaces?')) {
			return { items: [{ metadata: { name: 'review-2' } }, { metadata: { name: 'review-1' } }] };
		}
		if (path.startsWith('/api/v1/services?')) {
			return {
				items: ['review-1', 'review-2'].map((namespace) => ({
					metadata: { name: 'mysql', namespace },
					spec: { ports: [{ name: 'mysql', port: 3306 }] }
				}))
			};
		}
		const ns = /namespaces\/([^/]+)\/secrets/.exec(path)?.[1];
		return { data: { 'root-password': Buffer.from(`pw-${ns}`).toString('base64') } };
	});
}

async function merged() {
	const config = baseConfig();
	const request = fakeRequest();
	discoveryFor(config, { request: request as never });
	return { config: await requestConfig(config), base: config, request };
}

describe('requestConfig', () => {
	it('appends the discovered servers after the configured ones', async () => {
		const { config } = await merged();
		expect(config.Servers.map((s) => s.discovered?.id ?? s.host)).toEqual([
			'static-1',
			'static-2',
			'k8s:review-1/mysql',
			'k8s:review-2/mysql'
		]);
	});

	it('returns the same object while the list is unchanged', async () => {
		const { base } = await merged();
		expect(await requestConfig(base)).toBe(await requestConfig(base));
	});

	it('leaves a config without discovery as it is', async () => {
		const plain = configSchema.parse({});
		expect(await requestConfig(plain)).toBe(plain);
	});
});

describe('serverKey / findServerIndex', () => {
	it('names configured servers by position and discovered ones by id', async () => {
		const { config } = await merged();
		expect([1, 2, 3, 4].map((i) => serverKey(config, i))).toEqual([
			'1',
			'2',
			'k8s:review-1/mysql',
			'k8s:review-2/mysql'
		]);
		expect(findServerIndex(config, '2')).toBe(2);
		expect(findServerIndex(config, 'k8s:review-2/mysql')).toBe(4);
	});

	it('refuses unknown names and positions of discovered servers (they shift)', async () => {
		const { config } = await merged();
		for (const key of ['0', '3', '9', '-1', '1e0', 'k8s:review-9/mysql', '', null, undefined]) {
			expect(findServerIndex(config, key)).toBeNull();
		}
	});
});

describe('withAccount', () => {
	it('fills in the account of a discovered server from its Secret', async () => {
		const { config } = await merged();
		const withPw = await withAccount(config, 4);
		expect(withPw.Servers[3]).toMatchObject({ user: 'root', password: 'pw-review-2' });
		expect(config.Servers[3].password).toBe('');
	});

	it('leaves configured servers alone', async () => {
		const { config, request } = await merged();
		expect(await withAccount(config, 1)).toBe(config);
		expect(request.mock.calls.some((c) => String(c[3]).includes('/secrets/'))).toBe(false);
	});
});

describe('switchableServers', () => {
	const alice: Identity = { user: 'alice', groups: ['dev'] };

	it('offers a signon person only the servers RBAC lets them in, and always the current one', async () => {
		const { config } = await merged();
		const authorize = vi.fn(async (_who: Identity, rbac: { namespace: string }) =>
			rbac.namespace === 'review-2'
				? { allowed: true as const }
				: { allowed: false as const, reason: '' }
		);
		const listed = await switchableServers(
			{ config, serverIndex: 3, identity: alice },
			authorize as never
		);
		expect(listed.map((s) => s.key)).toEqual([
			'1',
			'2',
			'k8s:review-1/mysql',
			'k8s:review-2/mysql'
		]);

		const elsewhere = await switchableServers(
			{ config, serverIndex: 1, identity: alice },
			authorize as never
		);
		expect(elsewhere.map((s) => s.key)).toEqual(['1', '2', 'k8s:review-2/mysql']);
	});

	it('hides a server whose RBAC check fails', async () => {
		const { config } = await merged();
		const authorize = vi.fn(async () => {
			throw new Error('API down');
		});
		const listed = await switchableServers(
			{ config, serverIndex: 1, identity: alice },
			authorize as never
		);
		expect(listed.map((s) => s.key)).toEqual(['1', '2']);
	});

	it('lists every server for people without a signon identity', async () => {
		const { config } = await merged();
		const authorize = vi.fn();
		const listed = await switchableServers(
			{ config, serverIndex: 1, identity: null },
			authorize as never
		);
		expect(listed).toHaveLength(4);
		expect(listed[2]).toEqual({
			key: 'k8s:review-1/mysql',
			index: 3,
			label: 'review-1',
			host: 'mysql.review-1.svc',
			port: 3306,
			auth: 'signon'
		});
		expect(authorize).not.toHaveBeenCalled();
	});
});

describe('firstAllowedServer', () => {
	const alice: Identity = { user: 'alice', groups: [] };
	const onlyReview2 = vi.fn(async (_who: Identity, rbac: { namespace: string }) =>
		rbac.namespace === 'review-2'
			? { allowed: true as const }
			: { allowed: false as const, reason: '' }
	);

	it('finds the first signon server RBAC allows, skipping the refused one and other auth types', async () => {
		const { config } = await merged();
		expect(await firstAllowedServer(config, alice, 3, onlyReview2 as never)).toBe(4);
		expect(await firstAllowedServer(config, alice, 4, onlyReview2 as never)).toBeNull();
	});

	it('counts a failing check as a refusal', async () => {
		const { config } = await merged();
		const down = vi.fn(async () => {
			throw new Error('API down');
		});
		expect(await firstAllowedServer(config, alice, 3, down as never)).toBeNull();
	});
});
