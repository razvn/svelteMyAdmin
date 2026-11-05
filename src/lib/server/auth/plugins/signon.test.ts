import { describe, expect, it } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { configSchema, type ServerConfigInput } from '../../config/schema';
import { resolveAuth, sessionInfo } from '../index';
import { identifyFromHeaders, signonAuth, signonDenial } from './signon';
import type { AuthContext } from './types';

const identity = {
	type: 'trusted-header' as const,
	userHeader: 'x-auth-request-user',
	emailHeader: 'x-auth-request-email',
	groupsHeader: 'x-auth-request-groups',
	trustedProxies: ['10.0.0.0/8', 'fd00::1']
};

const proxyHeaders = (extra: Record<string, string> = {}) =>
	new Headers({
		'x-auth-request-user': 'alice',
		'x-auth-request-email': 'alice@example.com',
		'x-auth-request-groups': 'dev, ops,,  ',
		...extra
	});

describe('signonDenial (audit)', () => {
	it('names the reason a claimed identity was refused', () => {
		expect(signonDenial(proxyHeaders(), '198.51.100.7', identity)).toEqual({
			reason: 'untrusted-proxy',
			claimedUser: 'alice'
		});
		expect(signonDenial(proxyHeaders(), null, identity)?.reason).toBe('untrusted-proxy');
		const bad = proxyHeaders({ 'x-auth-request-user': 'al\u0007ice' });
		expect(signonDenial(bad, '10.1.2.3', identity)).toEqual({
			reason: 'invalid-identity',
			claimedUser: 'al\u0007ice'
		});
	});

	it('is null for a trusted identity or when nobody is claimed', () => {
		expect(signonDenial(proxyHeaders(), '10.1.2.3', identity)).toBeNull();
		expect(signonDenial(new Headers(), '198.51.100.7', identity)).toBeNull();
	});
});

describe('identifyFromHeaders', () => {
	it('ignores forged headers from a peer that is not a trusted proxy', () => {
		expect(identifyFromHeaders(proxyHeaders(), '192.168.1.5', identity)).toBeNull();
		expect(identifyFromHeaders(proxyHeaders(), 'fd00::2', identity)).toBeNull();
		expect(identifyFromHeaders(proxyHeaders(), null, identity)).toBeNull();
	});

	it('trusts a peer inside a v4 CIDR, a single v6 address and IPv4-mapped v6 peers', () => {
		const alice = { user: 'alice', email: 'alice@example.com', groups: ['dev', 'ops'] };
		expect(identifyFromHeaders(proxyHeaders(), '10.42.0.7', identity)).toEqual(alice);
		expect(identifyFromHeaders(proxyHeaders(), 'fd00::1', identity)).toEqual(alice);
		expect(identifyFromHeaders(proxyHeaders(), '::ffff:10.42.0.7', identity)).toEqual(alice);
	});

	it('rejects a missing, blank or control-character user', () => {
		const peer = '10.0.0.1';
		expect(identifyFromHeaders(new Headers(), peer, identity)).toBeNull();
		expect(
			identifyFromHeaders(proxyHeaders({ 'x-auth-request-user': '   ' }), peer, identity)
		).toBeNull();
		expect(
			identifyFromHeaders(proxyHeaders({ 'x-auth-request-user': 'ali\tce' }), peer, identity)
		).toBeNull();
	});

	it('rejects a user header sent twice (joined with a comma: ambiguous)', () => {
		const h = new Headers([
			['x-auth-request-user', 'alice'],
			['x-auth-request-user', 'mallory']
		]);
		expect(identifyFromHeaders(h, '10.0.0.1', identity)).toBeNull();
	});

	it('trims the user, omits a missing email and defaults to no groups', () => {
		const h = new Headers({ 'x-auth-request-user': '  bob ' });
		expect(identifyFromHeaders(h, '10.0.0.1', identity)).toEqual({ user: 'bob', groups: [] });
	});

	it('reads the configured header names', () => {
		const custom = { ...identity, userHeader: 'remote-user', groupsHeader: 'remote-groups' };
		const h = new Headers({ 'remote-user': 'carol', 'remote-groups': 'a,b' });
		expect(identifyFromHeaders(h, '10.0.0.1', custom)).toEqual({
			user: 'carol',
			groups: ['a', 'b']
		});
	});
});

describe('signon plugin', () => {
	const ctx = (server: Partial<ServerConfigInput>, peer: string, headers = proxyHeaders()) =>
		({
			server: { user: 'root', password: 'rootpw', SignonURL: '', LogoutURL: '', ...server },
			request: new Request('http://x/', { headers }),
			serverIndex: 2,
			peerAddress: peer
		}) as unknown as AuthContext;

	it('connects with the server account and carries the identity', () => {
		expect(signonAuth.getCredentials(ctx({ Signon: { identity } }, '10.1.2.3'))).toEqual({
			serverIndex: 2,
			user: 'root',
			password: 'rootpw',
			identity: { user: 'alice', email: 'alice@example.com', groups: ['dev', 'ops'] }
		});
		expect(signonAuth.getCredentials(ctx({ Signon: { identity } }, '203.0.113.9'))).toBeNull();
	});

	it('sends unauthenticated users to SignonURL, else answers 401', () => {
		const redirect = signonAuth.unauthenticated(
			ctx({ SignonURL: '/oauth2/start?rd=/' }, '10.0.0.1')
		);
		expect(redirect.status).toBe(302);
		expect(redirect.headers.get('location')).toBe('/oauth2/start?rd=/');

		const denied = signonAuth.unauthenticated(ctx({}, '10.0.0.1'));
		expect(denied.status).toBe(401);
		expect(denied.headers.get('location')).toBeNull();
	});

	it('logs out to LogoutURL, else home', () => {
		const out = signonAuth.logout(ctx({ LogoutURL: '/oauth2/sign_out?rd=/' }, '10.0.0.1'));
		expect(out.headers.get('location')).toBe('/oauth2/sign_out?rd=/');
		expect(signonAuth.logout(ctx({}, '10.0.0.1')).headers.get('location')).toBe('/');
	});

	it('answers 503 when MySQL refuses the configured account', () => {
		expect(signonAuth.rejected!(ctx({}, '10.0.0.1')).status).toBe(503);
	});
});

describe('resolveAuth with signon', () => {
	const config = configSchema.parse({
		Servers: [
			{
				auth_type: 'signon',
				host: 'db.review-123',
				user: 'admin',
				password: 'secret',
				Signon: { identity: { trustedProxies: ['10.0.0.0/8'] } }
			}
		]
	});
	const base = (peerAddress: string, headers: Record<string, string>) => {
		const url = new URL('http://sma.local/db/app');
		return {
			request: new Request(url, { headers }),
			url,
			cookies: { get: () => undefined } as unknown as Cookies,
			config,
			clientIp: peerAddress,
			peerAddress
		};
	};

	it('authenticates the proxy user with the configured account', () => {
		const r = resolveAuth(base('10.0.0.5', { 'x-auth-request-user': 'alice' }));
		expect(r.status).toBe('ok');
		if (r.status !== 'ok') return;
		expect(r.creds).toMatchObject({ user: 'admin', password: 'secret' });
		expect(sessionInfo(r.server, r.creds)).toMatchObject({
			authType: 'signon',
			user: 'admin',
			identity: 'alice'
		});
	});

	it('leaves a request with forged headers from outside the proxy unauthenticated', () => {
		const r = resolveAuth(base('198.51.100.7', { 'x-auth-request-user': 'alice' }));
		expect(r.status).toBe('unauthenticated');
		expect(r.plugin.unauthenticated(r.ctx).status).toBe(401);
	});
});
