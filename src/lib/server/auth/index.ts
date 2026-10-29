import { N_ } from '#lib/i18n/translator.ts';
import type { Cookies } from '@sveltejs/kit';
import type { AppConfig, ServerConfig } from '../config/schema';
import { createConnection } from '../db/connection';
import { validateArbitraryServer } from './arbitrary-server';
import { GENERIC_LOGIN_ERROR, mapConnectError, RULE_MESSAGES, type RuleFailure } from './errors';
import { getAuthPlugin } from './plugins/index';
import { clearSessionCookie, readSession, setSessionCookie } from './plugins/cookie';
import type { AuthContext, AuthPlugin, Credentials } from './plugins/types';
import { checkRules } from './rules';
import { requiresSecondFactor } from '../two-factor/config';
import { loadTwoFactor } from '../two-factor/store';

export { getAuthPlugin } from './plugins/index';
export type { AuthContext, AuthPlugin, Credentials } from './plugins/types';
export { safeRedirectTarget } from './redirect';
export { resolveClientIp } from './client-ip';

/** Non-secret session facts exposed through `event.locals.session`. */
export interface SessionInfo {
	serverIndex: number;
	authType: ServerConfig['auth_type'];
	user: string;
	host: string;
	port: number;
	arbitrary: boolean;
}

/** Server definition with the user supplied host/port applied (arbitrary server login). */
export function effectiveServer(server: ServerConfig, creds?: Pick<Credentials, 'host' | 'port'>) {
	if (!creds?.host) return server;
	return { ...server, host: creds.host, port: creds.port ?? 0, socket: '' };
}

export function sessionInfo(server: ServerConfig, creds: Credentials): SessionInfo {
	const eff = effectiveServer(server, creds);
	return {
		serverIndex: creds.serverIndex,
		authType: server.auth_type,
		user: creds.user,
		host: eff.host,
		port: eff.port,
		arbitrary: !!creds.host
	};
}

/** Human label of a server: `verbose`, else host[:port]. */
export function serverLabel(server: Pick<ServerConfig, 'verbose' | 'host' | 'port'>): string {
	if (server.verbose) return server.verbose;
	return server.port ? `${server.host}:${server.port}` : server.host;
}

/**
 * Which configured server a request is about: the one stored in a valid session cookie,
 * else `?server=N`, else `ServerDefault` (0 or invalid = first server).
 */
export function pickServerIndex(
	config: AppConfig,
	cookies: Pick<Cookies, 'get'>,
	url: URL
): number {
	const session = readSession({ cookies: cookies as Cookies, config });
	if (session && config.Servers[session.serverIndex - 1]?.auth_type === 'cookie') {
		return session.serverIndex;
	}
	const asked = Number(url.searchParams.get('server'));
	if (Number.isInteger(asked) && asked >= 1 && asked <= config.Servers.length) return asked;
	const def = config.ServerDefault;
	return def >= 1 && def <= config.Servers.length ? def : 1;
}

export type AuthResolution =
	| { status: 'ok'; plugin: AuthPlugin; ctx: AuthContext; creds: Credentials; server: ServerConfig }
	| { status: 'unauthenticated'; plugin: AuthPlugin; ctx: AuthContext }
	| { status: 'forbidden'; plugin: AuthPlugin; ctx: AuthContext; failure: RuleFailure };

/** Build the auth context and decide whether the request carries valid, permitted credentials. */
export function resolveAuth(base: Omit<AuthContext, 'serverIndex' | 'server'>): AuthResolution {
	const serverIndex = pickServerIndex(base.config, base.cookies, base.url);
	const baseServer = base.config.Servers[serverIndex - 1];
	const ctx: AuthContext = { ...base, serverIndex, server: baseServer };
	const plugin = getAuthPlugin(baseServer.auth_type);
	const creds = plugin.getCredentials(ctx);
	if (!creds) return { status: 'unauthenticated', plugin, ctx };
	const server = effectiveServer(baseServer, creds);
	ctx.server = server;
	const failure = checkRules(server, creds.user, creds.password, ctx.clientIp);
	if (failure) return { status: 'forbidden', plugin, ctx, failure };
	return { status: 'ok', plugin, ctx, creds, server };
}

/** Open a connection with the credentials and close it again. Throws the driver error. */
export async function verifyCredentials(
	server: ServerConfig,
	user: string,
	password: string
): Promise<void> {
	const conn = await createConnection(server, user, password, {
		extra: { connectTimeout: 10_000 }
	});
	try {
		await conn.query('SELECT 1');
	} finally {
		await conn.end().catch(() => {});
	}
}

export interface LoginInput {
	serverIndex: number;
	user: string;
	password: string;
	host?: string;
	port?: string | number;
}

/** `twoFactor`: the password was right but a second factor is still required. */
export type LoginResult = { ok: true; twoFactor: boolean } | { ok: false; error: string };

/**
 * Cookie-auth login: arbitrary server validation, AllowDeny/AllowRoot/AllowNoPassword,
 * a real connection attempt, then the encrypted session cookie.
 */
export async function attemptLogin(
	ctx: Pick<AuthContext, 'cookies' | 'url' | 'config' | 'clientIp'>,
	input: LoginInput
): Promise<LoginResult> {
	const { config } = ctx;
	const baseServer = config.Servers[input.serverIndex - 1];
	if (!baseServer || baseServer.auth_type !== 'cookie') {
		return { ok: false, error: N_('Invalid server selected.') };
	}
	if (input.password.length >= 2000) {
		return {
			ok: false,
			error: N_(
				'Your password is too long. To prevent denial-of-service attacks, phpMyAdmin restricts passwords to less than 2000 characters.'
			)
		};
	}
	const user = input.user.split('\0')[0];
	if (user === '') return { ok: false, error: GENERIC_LOGIN_ERROR };

	let arbitrary: { host: string; port?: number } | undefined;
	if (config.AllowArbitraryServer && input.host?.trim()) {
		const v = validateArbitraryServer(input.host, input.port, config.ArbitraryServerRegexp);
		if (!v.ok) return { ok: false, error: v.error };
		arbitrary = { host: v.host, port: v.port };
	}
	const server = effectiveServer(baseServer, arbitrary);

	const failure = checkRules(server, user, input.password, ctx.clientIp);
	if (failure) return { ok: false, error: RULE_MESSAGES[failure] };

	try {
		await verifyCredentials(server, user, input.password);
	} catch (e) {
		return { ok: false, error: mapConnectError(e, baseServer.hide_connection_errors) };
	}
	// Does the account have a second factor? Fail closed when the storage is configured but unreadable.
	let twoFactor: boolean;
	try {
		const stored = await loadTwoFactor(
			server,
			{ get: () => createConnection(server, user, input.password), closeOwn: true },
			user
		);
		twoFactor = stored !== null && requiresSecondFactor(stored.config);
	} catch {
		return { ok: false, error: N_('Could not read the two-factor authentication settings.') };
	}
	setSessionCookie(
		ctx.cookies,
		config,
		ctx.url,
		{
			serverIndex: input.serverIndex,
			host: arbitrary?.host,
			port: arbitrary?.port,
			user,
			password: input.password
		},
		undefined,
		twoFactor ? false : undefined
	);
	return { ok: true, twoFactor };
}

/**
 * After the connected user changed their own password: re-seal the session cookie with the new one so the
 * user stays logged in. Only cookie auth keeps the password; returns false for the other auth types
 * (`config` has a fixed password, `http` sends it with every request) or when there is no session.
 */
export function updateSessionPassword(
	ctx: Pick<AuthContext, 'cookies' | 'url' | 'config'>,
	newPassword: string
): boolean {
	const session = readSession(ctx);
	if (!session) return false;
	setSessionCookie(
		ctx.cookies,
		ctx.config,
		ctx.url,
		{
			serverIndex: session.serverIndex,
			host: session.host,
			port: session.port,
			user: session.user,
			password: newPassword
		},
		session.createdAt,
		session.twoFactorVerified
	);
	return true;
}

export { clearSessionCookie };
