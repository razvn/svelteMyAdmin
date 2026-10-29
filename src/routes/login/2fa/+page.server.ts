import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { safeRedirectTarget } from '#lib/server/auth/index.ts';
import { readSession, setSessionCookie } from '#lib/server/auth/plugins/cookie.ts';
import { NO_TWO_FACTOR } from '#lib/server/two-factor/config.ts';
import { challenge, check, type FlowCtx } from '#lib/server/two-factor/flow.ts';
import { loadTwoFactor } from '#lib/server/two-factor/store.ts';
import type { Actions, PageServerLoad } from './$types';

function flowCtx(event: RequestEvent): FlowCtx | null {
	const pending = event.locals.twoFactorPending;
	if (!pending) return null;
	return {
		server: event.locals.server,
		own: { get: () => event.locals.db },
		config: event.locals.config,
		cookies: event.cookies,
		url: event.url,
		user: pending.user,
		serverIndex: event.locals.serverIndex
	};
}

export const load: PageServerLoad = async (event) => {
	const redirectTo = safeRedirectTarget(event.url.searchParams.get('redirect'));
	const ctx = flowCtx(event);
	if (!ctx) redirect(303, event.locals.session ? redirectTo : '/login');
	const stored = await loadTwoFactor(ctx.server, ctx.own, ctx.user);
	const view = await challenge(ctx, stored?.config ?? NO_TWO_FACTOR, 'login');
	return {
		user: ctx.user,
		redirectTo: event.url.searchParams.get('redirect') ? redirectTo : '',
		view
	};
};

export const actions: Actions = {
	default: async (event) => {
		const ctx = flowCtx(event);
		if (!ctx) redirect(303, '/login');
		const stored = await loadTwoFactor(ctx.server, ctx.own, ctx.user);
		const cfg = stored?.config ?? NO_TWO_FACTOR;
		const fd = await event.request.formData();
		const result = await check(ctx, cfg, fd, 'login');
		if (!result.ok) {
			// a fresh challenge for the retry (WebAuthn)
			const view = await challenge(ctx, cfg, 'login');
			return fail(401, { error: result.error, view });
		}
		const { config } = event.locals;
		const session = readSession({ cookies: event.cookies, config });
		if (!session) redirect(303, '/login');
		setSessionCookie(
			event.cookies,
			config,
			event.url,
			{
				serverIndex: session.serverIndex,
				host: session.host,
				port: session.port,
				user: session.user,
				password: session.password
			},
			session.createdAt,
			true
		);
		const redirectField = fd.get('redirect');
		redirect(303, safeRedirectTarget(typeof redirectField === 'string' ? redirectField : null));
	}
};
