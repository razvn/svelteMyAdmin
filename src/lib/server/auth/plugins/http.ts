import { N_ } from '#lib/i18n/translator.ts';
import type { AuthContext, AuthPlugin } from './types';

/** Realm: `auth_http_realm` or `svelteMyAdmin <verbose|host>`, printable ASCII only. */
export function httpRealm(ctx: Pick<AuthContext, 'server'>): string {
	const s = ctx.server;
	const realm = s.auth_http_realm || `svelteMyAdmin ${s.verbose || s.host}`;
	return realm.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '');
}

function challenge(ctx: AuthContext, body: string): Response {
	return new Response(ctx.t ? ctx.t(body) : body, {
		status: 401,
		headers: {
			'WWW-Authenticate': `Basic realm="${httpRealm(ctx)}"`,
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store'
		}
	});
}

/** Parse `Authorization: Basic base64(user:password)`. */
export function parseBasicAuth(header: string | null): { user: string; password: string } | null {
	if (!header) return null;
	const m = header.match(/^Basic\s+([A-Za-z0-9+/=_-]+)$/i);
	if (!m) return null;
	const decoded = Buffer.from(m[1], 'base64').toString('utf8');
	const i = decoded.indexOf(':');
	if (i < 0) return null;
	const user = decoded.slice(0, i);
	if (user === '') return null;
	return { user: user.split('\0')[0], password: decoded.slice(i + 1) };
}

/** `http` auth: HTTP Basic credentials presented with every request. */
export const httpAuth: AuthPlugin = {
	type: 'http',

	getCredentials(ctx) {
		const basic = parseBasicAuth(ctx.request.headers.get('authorization'));
		if (!basic) return null;
		return { serverIndex: ctx.serverIndex, ...basic };
	},

	unauthenticated(ctx) {
		return challenge(ctx, N_('Authentication required.'));
	},

	rejected(ctx) {
		return challenge(ctx, N_('Cannot log in to the MySQL server'));
	},

	logout(ctx) {
		return challenge(ctx, N_('Logged out.'));
	}
};
