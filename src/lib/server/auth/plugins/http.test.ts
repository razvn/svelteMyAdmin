import { describe, expect, it } from 'vitest';
import { httpAuth, httpRealm, parseBasicAuth } from './http';
import type { AuthContext } from './types';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('parseBasicAuth', () => {
	it('parses user and password (password may contain colons)', () => {
		expect(parseBasicAuth(`Basic ${b64('bob:pa:ss')}`)).toEqual({ user: 'bob', password: 'pa:ss' });
		expect(parseBasicAuth(`basic ${b64('bob:')}`)).toEqual({ user: 'bob', password: '' });
	});
	it('rejects missing, malformed or empty-user headers', () => {
		expect(parseBasicAuth(null)).toBeNull();
		expect(parseBasicAuth('Bearer abc')).toBeNull();
		expect(parseBasicAuth(`Basic ${b64('nocolon')}`)).toBeNull();
		expect(parseBasicAuth(`Basic ${b64(':pw')}`)).toBeNull();
	});
});

describe('http plugin', () => {
	const ctx = (server: Record<string, string>, auth?: string) =>
		({
			server: { host: 'db.local', verbose: '', auth_http_realm: '', ...server },
			request: new Request('http://x/', { headers: auth ? { authorization: auth } : {} }),
			serverIndex: 2
		}) as unknown as AuthContext;

	it('builds the realm from verbose or host', () => {
		expect(httpRealm(ctx({}))).toBe('svelteMyAdmin db.local');
		expect(httpRealm(ctx({ verbose: 'Prod "DB"é' }))).toBe('svelteMyAdmin Prod DB');
		expect(httpRealm(ctx({ auth_http_realm: 'Custom' }))).toBe('Custom');
	});
	it('challenges with 401 + WWW-Authenticate, also on logout', () => {
		for (const res of [httpAuth.unauthenticated(ctx({})), httpAuth.logout(ctx({}))]) {
			expect(res.status).toBe(401);
			expect(res.headers.get('www-authenticate')).toBe('Basic realm="svelteMyAdmin db.local"');
		}
	});
	it('reads credentials from the header', () => {
		expect(httpAuth.getCredentials(ctx({}, `Basic ${b64('u:p')}`))).toEqual({
			serverIndex: 2,
			user: 'u',
			password: 'p'
		});
		expect(httpAuth.getCredentials(ctx({}))).toBeNull();
	});
});
