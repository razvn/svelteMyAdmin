import { N_, SOURCE_TRANSLATOR } from '#lib/i18n/translator.ts';
import type { SignonIdentityConfig } from '../../config/schema';
import { ipMaskTest } from '../ip-allow-deny';
import { authorizeIdentity } from '../signon/kubernetes';
import { redirectResponse, type AuthPlugin, type Identity } from './types';

/** Control characters, or a comma: `Headers.get` joins a header sent twice with ", ". */
const INVALID_USER = /[\p{Cc},]/u;

/**
 * Identity forwarded by the SSO proxy. The headers are only trusted when the TCP peer is one of
 * `trustedProxies`; from anyone else they are ignored (anybody can send them).
 */
export function identifyFromHeaders(
	headers: Pick<Headers, 'get'>,
	peerAddress: string | null,
	config: SignonIdentityConfig
): Identity | null {
	if (!peerAddress) return null;
	if (!config.trustedProxies.some((range) => ipMaskTest(range, peerAddress))) return null;
	const user = headers.get(config.userHeader)?.trim();
	if (!user || INVALID_USER.test(user)) return null;
	const email = headers.get(config.emailHeader)?.trim();
	const groups = (headers.get(config.groupsHeader) ?? '')
		.split(',')
		.map((g) => g.trim())
		.filter((g) => g !== '');
	return { user, ...(email ? { email } : {}), groups };
}

/**
 * Why a request that names a user in the identity header was not trusted (audit `denied`), or null
 * when it named nobody or was trusted.
 */
export function signonDenial(
	headers: Pick<Headers, 'get'>,
	peerAddress: string | null,
	config: SignonIdentityConfig
): { reason: 'untrusted-proxy' | 'invalid-identity'; claimedUser: string } | null {
	const claimedUser = headers.get(config.userHeader);
	if (claimedUser === null || claimedUser.trim() === '') return null;
	if (identifyFromHeaders(headers, peerAddress, config)) return null;
	const trusted =
		peerAddress !== null && config.trustedProxies.some((range) => ipMaskTest(range, peerAddress));
	return { reason: trusted ? 'invalid-identity' : 'untrusted-proxy', claimedUser };
}

/** `signon` auth: identity from an SSO proxy, MySQL account from the server definition. */
export const signonAuth: AuthPlugin = {
	type: 'signon',

	getCredentials(ctx) {
		const config = ctx.server.Signon?.identity;
		if (!config) return null;
		const identity = identifyFromHeaders(ctx.request.headers, ctx.peerAddress, config);
		if (!identity) return null;
		return {
			serverIndex: ctx.serverIndex,
			user: ctx.server.user,
			password: ctx.server.password,
			identity
		};
	},

	async authorize(ctx, creds) {
		const config = ctx.server.Signon?.authorize;
		if (!config) return { allowed: true };
		if (!creds.identity) throw new Error('signon credentials without an identity');
		const decision = await authorizeIdentity(creds.identity, config);
		if (decision.allowed) return decision;
		const message = N_('You do not have access to this server (Kubernetes namespace {namespace}).');
		return {
			allowed: false,
			message: (ctx.t ?? SOURCE_TRANSLATOR.t)(message, { namespace: config.namespace })
		};
	},

	unauthenticated(ctx) {
		if (ctx.server.SignonURL) return redirectResponse(ctx.server.SignonURL, 302);
		const body = N_('Authentication required.');
		return new Response(ctx.t ? ctx.t(body) : body, {
			status: 401,
			headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
		});
	},

	rejected(ctx) {
		const body = N_('Cannot log in to the MySQL server with the configured credentials.');
		return new Response(ctx.t ? ctx.t(body) : body, {
			status: 503,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	},

	logout(ctx) {
		return redirectResponse(ctx.server.LogoutURL || '/');
	}
};
