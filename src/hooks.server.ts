import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { sequence } from '@sveltejs/kit/hooks';
import {
	clearSessionCookie,
	resolveAuth,
	resolveClientIp,
	sessionInfo,
	type AuthResolution
} from '#lib/server/auth/index.ts';
import { isAccessDenied, RULE_MESSAGES } from '#lib/server/auth/errors.ts';
import { getConfig } from '#lib/server/config/index.ts';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { installTracking, type TrackingHook } from '#lib/server/pmadb/tracking-hook.ts';
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
import { SOURCE_TRANSLATOR } from '#lib/i18n/translator.ts';
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

/** Authentication, session and per-request database connection. */
const auth: Handle = async ({ event, resolve }) => {
	const config = getConfig();
	let clientIp: string | null;
	try {
		clientIp = resolveClientIp(
			event.getClientAddress(),
			event.request.headers,
			config.TrustedProxies
		);
	} catch {
		clientIp = null;
	}

	const resolution: AuthResolution = resolveAuth({
		request: event.request,
		url: event.url,
		cookies: event.cookies,
		config,
		clientIp,
		t: event.locals.i18n?.t
	});
	const { ctx, plugin } = resolution;

	// Lazy connection, closed after the response.
	let connection: Promise<Connection> | undefined;
	let creds = resolution.status === 'ok' ? resolution.creds : undefined;
	const server = resolution.status === 'ok' ? resolution.server : ctx.server;

	const open = async (): Promise<Connection> => {
		if (!creds) throw new Error('Not authenticated');
		const c = creds;
		const collation =
			event.cookies.get(COLLATION_COOKIE) || config.DefaultConnectionCollation || undefined;
		try {
			const conn = await createConnection(server, c.user, c.password, { collation });
			// Change tracking: the one place where statements of the user are recorded.
			trackingHook = installTracking(conn, server, c.user);
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
	event.locals.server = server;
	event.locals.clientIp = clientIp;
	// Cookie login whose second factor is still pending: not a session yet (see two-factor/gate.ts).
	const twoFactorPending =
		resolution.status === 'ok' &&
		plugin.type === 'cookie' &&
		isTwoFactorPending(readSession({ cookies: event.cookies, config }));
	event.locals.session =
		resolution.status === 'ok' && !twoFactorPending
			? sessionInfo(ctx.server, resolution.creds)
			: null;
	event.locals.twoFactorPending =
		resolution.status === 'ok' && twoFactorPending
			? sessionInfo(ctx.server, resolution.creds)
			: null;
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
			if (plugin.rejected && plugin.type === 'http') return plugin.rejected(ctx);
			return new Response(
				(event.locals.i18n ?? SOURCE_TRANSLATOR).t(RULE_MESSAGES[resolution.failure]),
				{
					status: 403,
					headers: { 'content-type': 'text/plain; charset=utf-8' }
				}
			);
		}

		if (resolution.status === 'unauthenticated') {
			if (isPublic) return await resolve(event);
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
					await close();
					return plugin.rejected(ctx);
				}
				throw e;
			}
		}

		// From here on `locals.config` is the server config overlaid with the user's preferences
		// (loaded once per request); the unmerged config stays available via `getConfig()`.
		if (!isPublic) {
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
