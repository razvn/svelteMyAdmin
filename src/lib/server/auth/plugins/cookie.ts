import type { Cookies } from '@sveltejs/kit';
import type { AppConfig } from '../../config/schema';
import { getSecret, openSession, sealSession, SESSION_COOKIE } from '../session';
import { redirectResponse, type AuthContext, type AuthPlugin, type Credentials } from './types';

/** `cookie` auth: login form, credentials in an encrypted session cookie. */
function cookieOptions(config: AppConfig, url: URL) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: url.protocol === 'https:',
		// 0 = browser-session cookie
		...(config.LoginCookieStore > 0 ? { maxAge: config.LoginCookieStore } : {})
	};
}

/** Store a (new) session cookie. `createdAt` is preserved across refreshes. */
export function setSessionCookie(
	cookies: Cookies,
	config: AppConfig,
	url: URL,
	creds: Credentials,
	createdAt: number = Date.now()
): void {
	const token = sealSession(
		{
			serverIndex: creds.serverIndex,
			...(creds.host ? { host: creds.host } : {}),
			...(creds.port ? { port: creds.port } : {}),
			user: creds.user,
			password: creds.password,
			createdAt,
			lastActivity: Date.now()
		},
		getSecret(config.blowfish_secret)
	);
	cookies.set(SESSION_COOKIE, token, cookieOptions(config, url));
}

export function clearSessionCookie(cookies: Cookies, config: AppConfig, url: URL): void {
	cookies.delete(SESSION_COOKIE, { ...cookieOptions(config, url), maxAge: undefined });
}

/** Decode the session cookie of a request, if valid. */
export function readSession(ctx: Pick<AuthContext, 'cookies' | 'config'>) {
	return openSession(
		ctx.cookies.get(SESSION_COOKIE),
		getSecret(ctx.config.blowfish_secret),
		ctx.config.LoginCookieValidity
	);
}

export const cookieAuth: AuthPlugin = {
	type: 'cookie',

	getCredentials(ctx) {
		const s = readSession(ctx);
		if (!s || s.serverIndex !== ctx.serverIndex) return null;
		if ((s.host || s.port) && !ctx.config.AllowArbitraryServer) return null;
		return {
			serverIndex: s.serverIndex,
			host: s.host,
			port: s.port,
			user: s.user,
			password: s.password
		};
	},

	touch(ctx, creds) {
		const s = readSession(ctx);
		setSessionCookie(ctx.cookies, ctx.config, ctx.url, creds, s?.createdAt);
	},

	unauthenticated(ctx) {
		const hadCookie = ctx.cookies.get(SESSION_COOKIE) !== undefined;
		if (hadCookie) clearSessionCookie(ctx.cookies, ctx.config, ctx.url);
		const params = new URLSearchParams();
		const method = ctx.request.method;
		if ((method === 'GET' || method === 'HEAD') && ctx.url.pathname !== '/') {
			params.set('redirect', ctx.url.pathname + ctx.url.search);
		}
		const qs = params.size ? `?${params}` : '';
		return redirectResponse(`/login${qs}`);
	},

	logout(ctx) {
		clearSessionCookie(ctx.cookies, ctx.config, ctx.url);
		const custom = ctx.server.LogoutURL;
		return redirectResponse(custom || '/login');
	}
};
