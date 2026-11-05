import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { sequence } from '@sveltejs/kit/hooks';
import {
	clearSessionCookie,
	resolveAuth,
	resolveClientIp,
	serverLabel,
	sessionInfo,
	isServerChosen,
	pickServerIndex,
	type AuthContext,
	type AuthPlugin,
	type AuthResolution,
	type Credentials
} from '#lib/server/auth/index.ts';
import { isAccessDenied, RULE_MESSAGES } from '#lib/server/auth/errors.ts';
import { getConfig, type AppConfig } from '#lib/server/config/index.ts';
import {
	findServerIndex,
	requestConfig,
	SERVER_COOKIE,
	serverKey,
	withAccount
} from '#lib/server/discovery/index.ts';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { installTracking, type TrackingHook } from '#lib/server/pmadb/tracking-hook.ts';
import { noAudit, requestAudit, type RequestAudit } from '#lib/server/audit/index.ts';
import { markActivity } from '#lib/server/audit/marker.ts';
import { installAudit } from '#lib/server/audit/statements.ts';
import { firstAllowedServer } from '#lib/server/discovery/switchable.ts';
import { getSecret } from '#lib/server/auth/session.ts';
import { signonDenial } from '#lib/server/auth/plugins/signon.ts';
import { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { COLLATION_COOKIE } from '#lib/server/db/collation-cookie.ts';
import { expiredLoginLocation } from '#lib/server/auth/expired.ts';
import { legacyRedirectTarget } from '#lib/server/routing/legacy.ts';
import { buildEffectiveConfig } from '#lib/server/preferences/effective.ts';
import {
	isPublicPath,
	isTwoFactorPending,
	twoFactorRedirect
} from '#lib/server/two-factor/gate.ts';
import { readSession } from '#lib/server/auth/plugins/cookie.ts';
import { loadPrefs } from '#lib/server/preferences/store.ts';
import { N_, SOURCE_TRANSLATOR } from '#lib/i18n/translator.ts';
import { applyLocale, fillHtmlLang } from '#lib/server/i18n/locale.ts';

const redirectTo = (location: string, status = 302) =>
	new Response(null, { status, headers: { location } });

/** Legacy `index.php?route=...` URLs -> new paths. Runs before authentication. */
const legacyRedirect: Handle = ({ event, resolve }) => {
	const target = legacyRedirectTarget(event.url);
	if (target !== null) return redirectTo(target);
	return resolve(event);
};

/** Language of the request (cookie, DefaultLang, Accept-Language) and `<html lang dir>`. */
const localeHandle: Handle = async ({ event, resolve }) => {
	await applyLocale(event);
	return resolve(event, {
		// Runs while rendering, i.e. after `auth` refined the locale with the user's `lang` preference.
		transformPageChunk: ({ html }) => fillHtmlLang(html, event.locals.locale)
	});
};

/** Wrap a response so `close` runs when its body has been fully sent or cancelled. */
async function closeAfterBody(res: Response, close: () => Promise<void>): Promise<Response> {
	if (!res.body) {
		await close();
		return res;
	}
	const reader = res.body.getReader();
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					controller.close();
					await close();
				} else {
					controller.enqueue(value);
				}
			} catch (e) {
				await close();
				controller.error(e);
			}
		},
		async cancel(reason) {
			await reader.cancel(reason).catch(() => {});
			await close();
		}
	});
	return new Response(body, {
		status: res.status,
		statusText: res.statusText,
		headers: res.headers
	});
}

/** Why an authenticated person may not use the server (`plugin.authorize`), as a response to send. */
interface Refusal {
	status: 403 | 503;
	reason: 'not-authorized' | 'authorization-error';
	message: string;
	claimedUser: string;
}

/** Ask the plugin whether the person may use the server. Fails closed when it cannot tell. */
async function checkAccess(
	plugin: AuthPlugin,
	ctx: AuthContext,
	creds: Credentials
): Promise<Refusal | null> {
	if (!plugin.authorize) return null;
	const claimedUser = creds.identity?.user ?? creds.user;
	try {
		const decision = await plugin.authorize(ctx, creds);
		if (decision.allowed) return null;
		return { status: 403, reason: 'not-authorized', message: decision.message, claimedUser };
	} catch (e) {
		console.error('[auth] cannot verify access to the server:', e);
		const message = N_('Cannot verify your access right now.');
		return {
			status: 503,
			reason: 'authorization-error',
			message: ctx.t ? ctx.t(message) : message,
			claimedUser
		};
	}
}

const unavailable = (event: Parameters<Handle>[0]['event'], message: string) =>
	new Response((event.locals.i18n ?? SOURCE_TRANSLATOR).t(message), {
		status: 503,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
	});

/**
 * The configuration of the request: discovered servers appended, and the account of the requested
 * one read when it is discovered. A Response when no server can be used right now.
 */
async function serversOfRequest(
	event: Parameters<Handle>[0]['event']
): Promise<AppConfig | Response> {
	let config: AppConfig;
	try {
		config = await requestConfig(getConfig());
	} catch (e) {
		console.error('[discovery] cannot list the servers:', e);
		return unavailable(event, N_('Cannot list the database servers right now.'));
	}
	if (config.Servers.length === 0) {
		return unavailable(event, N_('No database server is available right now.'));
	}
	try {
		return await withAccount(config, pickServerIndex(config, event.cookies, event.url));
	} catch (e) {
		console.error('[discovery] cannot read the account of the server:', e);
		return unavailable(event, N_('Cannot read the account of this server right now.'));
	}
}

/** Authentication, session and per-request database connection. */
const auth: Handle = async ({ event, resolve }) => {
	// The health check must not depend on the Kubernetes API or a database.
	if (event.url.pathname === '/api/health') return resolve(event);
	const servers = await serversOfRequest(event);
	if (servers instanceof Response) return servers;
	const config = servers;
	let peerAddress: string | null;
	try {
		peerAddress = event.getClientAddress();
	} catch {
		peerAddress = null;
	}
	const clientIp = resolveClientIp(peerAddress, event.request.headers, config.TrustedProxies);

	const resolution: AuthResolution = resolveAuth({
		request: event.request,
		url: event.url,
		cookies: event.cookies,
		config,
		clientIp,
		peerAddress,
		t: event.locals.i18n?.t
	});
	const { ctx, plugin } = resolution;
	// Settled before anything below can create a session or open a connection.
	const refusal =
		resolution.status === 'ok' ? await checkAccess(plugin, ctx, resolution.creds) : null;
	const authenticated = resolution.status === 'ok' && !refusal;

	// Lazy connection, closed after the response.
	let connection: Promise<Connection> | undefined;
	let creds = authenticated ? resolution.creds : undefined;
	const server = resolution.status === 'ok' ? resolution.server : ctx.server;

	const open = async (): Promise<Connection> => {
		if (!creds) throw new Error('Not authenticated');
		const c = creds;
		const collation =
			event.cookies.get(COLLATION_COOKIE) || config.DefaultConnectionCollation || undefined;
		try {
			const conn = await createConnection(server, c.user, c.password, { collation });
			// Change tracking and the audit log: the one place where statements of the user are
			// recorded. Independent layers (either may be off); each sees every statement once.
			trackingHook = installTracking(conn, server, c.identity?.user ?? c.user);
			if (config.AuditLog) installAudit(conn, audit, config.AuditLog);
			return conn;
		} catch (e) {
			// Cookie sessions whose credentials MySQL no longer accepts (e.g. the password was
			// changed): drop the session and go back to the login form instead of an error page.
			if (plugin.type === 'cookie' && isAccessDenied(e)) {
				clearSessionCookie(event.cookies, config, event.url);
				redirect(303, expiredLoginLocation(event.request.method, event.url));
			}
			throw e;
		}
	};
	let trackingHook: TrackingHook | null = null;
	let dbi: Promise<DatabaseInterface> | undefined;

	event.locals.config = config;
	event.locals.serverIndex = ctx.serverIndex;
	event.locals.serverId = serverKey(config, ctx.serverIndex);
	event.locals.identity = authenticated ? (resolution.creds.identity ?? null) : null;
	// Remember an explicit choice for auth types without a session cookie of their own.
	const asked = event.url.searchParams.get('server');
	if (
		asked &&
		findServerIndex(config, asked) === ctx.serverIndex &&
		event.cookies.get(SERVER_COOKIE) !== event.locals.serverId
	) {
		event.cookies.set(SERVER_COOKIE, event.locals.serverId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: event.url.protocol === 'https:'
		});
	}
	event.locals.server = server;
	event.locals.clientIp = clientIp;
	event.locals.peerAddress = peerAddress;
	// Cookie login whose second factor is still pending: not a session yet (see two-factor/gate.ts).
	const twoFactorPending =
		resolution.status === 'ok' &&
		plugin.type === 'cookie' &&
		isTwoFactorPending(readSession({ cookies: event.cookies, config }));
	event.locals.session =
		authenticated && !twoFactorPending ? sessionInfo(ctx.server, resolution.creds) : null;
	event.locals.twoFactorPending =
		resolution.status === 'ok' && twoFactorPending
			? sessionInfo(ctx.server, resolution.creds)
			: null;
	const session = event.locals.session;
	const audit: RequestAudit = config.AuditLog
		? requestAudit(config.AuditLog, {
				identity: session?.storageUser ?? null,
				mysqlUser: session?.user ?? null,
				...(session && resolution.status === 'ok' && resolution.creds.identity?.email
					? { email: resolution.creds.identity.email }
					: {}),
				server: serverLabel(server),
				serverId: event.locals.serverId,
				clientIp
			})
		: noAudit;
	event.locals.audit = audit;
	Object.defineProperty(event.locals, 'db', {
		configurable: true,
		get: () => (connection ??= open())
	});
	Object.defineProperty(event.locals, 'dbi', {
		configurable: true,
		get: () => (dbi ??= event.locals.db.then((c) => new DatabaseInterface(c, event.locals.server)))
	});

	const close = async () => {
		const pending = connection;
		connection = undefined;
		creds = undefined;
		if (pending) {
			const conn = await pending.catch(() => undefined);
			await trackingHook?.close();
			await conn?.end().catch(() => {});
		}
	};

	const run = async (): Promise<Response> => {
		const pathname = event.url.pathname;
		const isPublic = isPublicPath(pathname);

		if (resolution.status === 'forbidden') {
			if (isPublic) return await resolve(event);
			const { creds } = resolution;
			audit.write(
				{
					event: 'denied',
					reason: resolution.failure,
					claimedUser: creds.identity?.user ?? creds.user
				},
				{ mysqlUser: creds.user }
			);
			if (plugin.rejected && plugin.type === 'http') return plugin.rejected(ctx);
			return new Response(
				(event.locals.i18n ?? SOURCE_TRANSLATOR).t(RULE_MESSAGES[resolution.failure]),
				{
					status: 403,
					headers: { 'content-type': 'text/plain; charset=utf-8' }
				}
			);
		}

		if (refusal) {
			// Like an unauthenticated request: public pages render without a session.
			if (isPublic) return await resolve(event);
			let { message } = refusal;
			const identity = resolution.status === 'ok' ? resolution.creds.identity : undefined;
			// Nobody asked for this server, it is only the default: with one review environment per
			// merge request, send the person to one they may use instead of a dead end.
			if (
				refusal.reason === 'not-authorized' &&
				identity &&
				!isServerChosen(config, event.cookies, event.url)
			) {
				const other = await firstAllowedServer(config, identity, ctx.serverIndex);
				if (other !== null && (event.request.method === 'GET' || event.request.method === 'HEAD')) {
					const to = new URL(event.url);
					to.searchParams.set('server', serverKey(config, other));
					return redirectTo(to.pathname + to.search, 303);
				}
				// With other servers to try and none allowed, the namespace message would mislead.
				const triedOthers = config.Servers.some(
					(s, i) => i + 1 !== ctx.serverIndex && s.auth_type === 'signon'
				);
				if (other === null && triedOthers) {
					message = (event.locals.i18n ?? SOURCE_TRANSLATOR).t(
						N_('You do not have access to any database server.')
					);
				}
			}
			const { reason, claimedUser } = refusal;
			audit.write({ event: 'denied', reason, claimedUser });
			return new Response(message, {
				status: refusal.status,
				headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
			});
		}

		if (resolution.status === 'unauthenticated') {
			if (isPublic) return await resolve(event);
			const identityConfig = ctx.server.auth_type === 'signon' && ctx.server.Signon?.identity;
			const denial = identityConfig
				? signonDenial(event.request.headers, peerAddress, identityConfig)
				: null;
			if (denial) audit.write({ event: 'denied', ...denial });
			return plugin.unauthenticated(ctx);
		}

		// Authenticated: slide the session expiry.
		if (pathname !== '/api/health') plugin.touch?.(ctx, resolution.creds);

		if (twoFactorPending) {
			const to = twoFactorRedirect(true, event.request.method, pathname, event.url.search);
			if (to) return redirectTo(to, 303);
		}

		// `http`/`config` auth have no login step: verify the credentials right away
		// so wrong ones produce a new challenge instead of an error page.
		if (!isPublic && plugin.type !== 'cookie' && plugin.rejected) {
			try {
				await event.locals.db;
			} catch (e) {
				if (isAccessDenied(e) || plugin.type === 'config') {
					if (plugin.type === 'http' && isAccessDenied(e)) {
						audit.write(
							{ event: 'denied', reason: 'access-denied', claimedUser: resolution.creds.user },
							{ identity: null, mysqlUser: null }
						);
					}
					await close();
					return plugin.rejected(ctx);
				}
				throw e;
			}
		}

		// From here on `locals.config` is the server config overlaid with the user's preferences
		// (loaded once per request); the unmerged config stays available via `getConfig()`.
		if (!isPublic) {
			if (config.AuditLog && session) {
				const fresh = markActivity(event.cookies, {
					secret: getSecret(config.blowfish_secret),
					secure: event.url.protocol === 'https:',
					idleMinutes: config.AuditLog.sessionIdleMinutes,
					who: { user: session.storageUser, server: event.locals.serverId }
				});
				if (fresh) audit.write({ event: 'session' });
			}
			const prefs = await loadPrefs(event.locals, event.cookies);
			await applyLocale(event, prefs.data.lang);
			const effective = buildEffectiveConfig(config, prefs.data, ctx.serverIndex);
			event.locals.config = effective.config;
			if (Object.keys(effective.serverOverrides).length > 0) {
				event.locals.server = { ...event.locals.server, ...effective.serverOverrides };
			}
		}

		return resolve(event);
	};

	let response: Response;
	try {
		response = await run();
	} catch (e) {
		await close();
		throw e;
	}
	// Close after the body has been fully streamed (or the client went away).
	return connection ? closeAfterBody(response, close) : response;
};

export const handle: Handle = sequence(legacyRedirect, localeHandle, auth);

export const handleError: HandleServerError = ({ kind, error, event }) => {
	const { t } = event.locals.i18n ?? SOURCE_TRANSLATOR;
	if (kind === 'app' || kind === 'framework' || kind === 'validation') {
		const { status, message } = error;
		if (status >= 500)
			console.error(`[${event.request.method} ${event.url.pathname}] ${status} ${message}`);
		return { status, message };
	}
	if (isAccessDenied(error)) {
		return { status: 401, message: t('Cannot log in to the MySQL server. Please log in again.') };
	}
	const err = error instanceof Error ? error : new Error(String(error));
	console.error(`[${event.request.method} ${event.url.pathname}]`, err);
	return { status: 500, message: t('Internal Error') };
};
