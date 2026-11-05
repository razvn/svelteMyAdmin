import type { Cookies } from '@sveltejs/kit';
import type { Params } from '#lib/i18n/interpolate.ts';
import type { AppConfig, ServerConfig } from '../../config/schema';

/** Person authenticated by an SSO proxy (`signon` auth). */
export interface Identity {
	user: string;
	email?: string;
	groups: string[];
}

/** What the DB connection is opened with. Never sent to the client. */
export interface Credentials {
	serverIndex: number;
	/** Set for arbitrary-server logins only. */
	host?: string;
	port?: number;
	user: string;
	password: string;
	/** `signon` only: who the proxy authenticated (the MySQL account is the server's `user`). */
	identity?: Identity;
}

export interface AuthContext {
	request: Request;
	url: URL;
	cookies: Cookies;
	config: AppConfig;
	/** 1-based index into `config.Servers`. */
	serverIndex: number;
	server: ServerConfig;
	clientIp: string | null;
	/** Direct TCP peer of the request (not resolved through `TrustedProxies`), null if unknown. */
	peerAddress: string | null;
	/** Translation function of the request (`locals.i18n.t`); English when absent. */
	t?: (msgid: string, params?: Params) => string;
}

export type AuthType = ServerConfig['auth_type'];

/** `message`: why the person may not use this server, translated, safe to show. */
export type AccessDecision = { allowed: true } | { allowed: false; message: string };

export interface AuthPlugin {
	readonly type: AuthType;
	/** Credentials presented with the current request, or null when not logged in. */
	getCredentials(ctx: AuthContext): Credentials | null;
	/**
	 * May the authenticated person use this server? Awaited before the request gets a session or a
	 * connection. Throws when the answer cannot be obtained (the request is refused).
	 */
	authorize?(ctx: AuthContext, creds: Credentials): Promise<AccessDecision>;
	/** Called for every authenticated request (sliding session refresh). */
	touch?(ctx: AuthContext, creds: Credentials): void;
	/** Response for a request that needs authentication but has none (or invalid ones). */
	unauthenticated(ctx: AuthContext): Response;
	/** Response to a failed credential check on an authenticated request. */
	rejected?(ctx: AuthContext): Response;
	/** Clear the session and answer the logout request. */
	logout(ctx: AuthContext): Response;
}

export function redirectResponse(location: string, status = 303): Response {
	return new Response(null, { status, headers: { location } });
}
