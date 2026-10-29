import type { Cookies } from '@sveltejs/kit';
import type { AppConfig, ServerConfig } from '../../config/schema';

/** What the DB connection is opened with. Never sent to the client. */
export interface Credentials {
	serverIndex: number;
	/** Set for arbitrary-server logins only. */
	host?: string;
	port?: number;
	user: string;
	password: string;
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
	/** Translation function of the request (`locals.i18n.t`); English when absent. */
	t?: (msgid: string) => string;
}

export type AuthType = ServerConfig['auth_type'];

export interface AuthPlugin {
	readonly type: AuthType;
	/** Credentials presented with the current request, or null when not logged in. */
	getCredentials(ctx: AuthContext): Credentials | null;
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
