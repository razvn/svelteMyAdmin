import { describe, expect, it } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import type { AppConfig } from '../config/schema';
import { updateSessionPassword } from './index';
import { openSession, sealSession, SESSION_COOKIE } from './session';

const config = {
	blowfish_secret: 'a-test-secret-with-enough-entropy-1234',
	LoginCookieValidity: 1440,
	LoginCookieStore: 0
} as AppConfig;
const url = new URL('http://localhost/server/user-password');

function fakeCookies(initial?: string) {
	const jar = new Map<string, string>();
	if (initial) jar.set(SESSION_COOKIE, initial);
	const cookies = {
		get: (n: string) => jar.get(n),
		set: (n: string, v: string) => void jar.set(n, v),
		delete: (n: string) => void jar.delete(n)
	} as unknown as Cookies;
	return { cookies, jar };
}

describe('updateSessionPassword', () => {
	it('re-seals the cookie with the new password and keeps everything else', () => {
		const now = Date.now();
		const token = sealSession(
			{
				serverIndex: 2,
				host: 'db.example',
				port: 3307,
				user: 'alice',
				password: 'old',
				createdAt: now - 5000,
				lastActivity: now - 1000
			},
			config.blowfish_secret
		);
		const { cookies, jar } = fakeCookies(token);
		expect(updateSessionPassword({ cookies, url, config }, "n'ew pw")).toBe(true);
		const s = openSession(jar.get(SESSION_COOKIE), config.blowfish_secret, 1440);
		expect(s).toMatchObject({
			serverIndex: 2,
			host: 'db.example',
			port: 3307,
			user: 'alice',
			password: "n'ew pw",
			createdAt: now - 5000
		});
	});

	it('does nothing without a valid session', () => {
		const { cookies, jar } = fakeCookies();
		expect(updateSessionPassword({ cookies, url, config }, 'x')).toBe(false);
		expect(jar.size).toBe(0);
		const bad = fakeCookies('garbage');
		expect(updateSessionPassword({ cookies: bad.cookies, url, config }, 'x')).toBe(false);
	});
});
