import { describe, expect, it } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import type { AppConfig } from '../../config/schema';
import { getSecret, openSession, sealSession, SESSION_COOKIE } from '../session';
import { cookieAuth, needsRefresh } from './cookie';
import type { AuthContext } from './types';

const config = { blowfish_secret: 'x'.repeat(32), LoginCookieValidity: 1440, LoginCookieStore: 0 };

function ctxWith(lastActivity: number) {
	const jar = new Map<string, string>();
	const sets: string[] = [];
	jar.set(
		SESSION_COOKIE,
		sealSession(
			{
				serverIndex: 1,
				user: 'u',
				password: 'p',
				createdAt: lastActivity,
				lastActivity
			},
			getSecret(config.blowfish_secret)
		)
	);
	const cookies = {
		get: (n: string) => jar.get(n),
		set: (n: string, v: string) => {
			jar.set(n, v);
			sets.push(v);
		}
	} as unknown as Cookies;
	const ctx = {
		cookies,
		config: config as unknown as AppConfig,
		url: new URL('http://localhost/')
	} as unknown as AuthContext;
	return { ctx, sets };
}

describe('cookie touch', () => {
	it('does not re-seal a recently active session (stale in-flight requests must not resurrect it)', () => {
		const { ctx, sets } = ctxWith(Date.now() - 2_000);
		cookieAuth.touch!(ctx, { serverIndex: 1, user: 'u', password: 'p' });
		expect(sets).toHaveLength(0);
	});

	it('slides the expiry once the session is older than the refresh interval', () => {
		const old = Date.now() - 120_000;
		const { ctx, sets } = ctxWith(old);
		cookieAuth.touch!(ctx, { serverIndex: 1, user: 'u', password: 'p' });
		expect(sets).toHaveLength(1);
		const s = openSession(sets[0], getSecret(config.blowfish_secret), 1440);
		expect(s!.lastActivity).toBeGreaterThan(old);
	});

	it('uses a shorter interval for tiny validities', () => {
		expect(needsRefresh(0, 40, 9_000)).toBe(false);
		expect(needsRefresh(0, 40, 10_000)).toBe(true);
		expect(needsRefresh(0, 1440, 59_000)).toBe(false);
		expect(needsRefresh(0, 1440, 60_000)).toBe(true);
	});
});
