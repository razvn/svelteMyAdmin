import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import {
	allBackends,
	availableBackends,
	BACKENDS,
	effectiveBackend,
	NO_TWO_FACTOR
} from '#lib/server/two-factor/config.ts';
import { challenge, check, configure, setup, type FlowCtx } from '#lib/server/two-factor/flow.ts';
import { loadTwoFactor, saveTwoFactor } from '#lib/server/two-factor/store.ts';
import type { Actions, PageServerLoad } from './$types';

function flowCtx(event: RequestEvent): FlowCtx {
	return {
		server: event.locals.server,
		own: { get: () => event.locals.db },
		config: event.locals.config,
		cookies: event.cookies,
		url: event.url,
		user: event.locals.session?.user ?? '',
		serverIndex: event.locals.serverIndex
	};
}

export const load: PageServerLoad = async (event) => {
	const ctx = flowCtx(event);
	const stored = await loadTwoFactor(ctx.server, ctx.own, ctx.user).catch(() => null);
	const available = availableBackends(ctx.config.DBG);
	const cfg = stored?.config ?? NO_TWO_FACTOR;
	const current = BACKENDS[effectiveBackend(cfg.backend, available)];
	return {
		/** The configuration storage can hold the setting (phpMyAdmin: `isWritable`). */
		enabled: stored !== null,
		backend: current,
		backends: allBackends(available),
		saved: event.url.searchParams.get('saved')
	};
};

const backendSchema = z.string().max(40);

export const actions: Actions = {
	configure: async (event) => {
		const ctx = flowCtx(event);
		const fd = await event.request.formData();
		const parsed = backendSchema.safeParse(fd.get('2fa_configure'));
		if (!parsed.success) return fail(400, { error: 'Invalid request.' });
		const backend = parsed.data;
		const stored = await loadTwoFactor(ctx.server, ctx.own, ctx.user);
		if (!stored) return fail(400, { error: 'Two-factor authentication is not available.' });
		if (stored.config.backend !== '') {
			return fail(400, { error: 'Disable the current two-factor authentication first.' });
		}
		if (backend === '' || !availableBackends(ctx.config.DBG).includes(backend)) {
			return fail(400, { error: 'Choose an authentication method.' });
		}
		if (fd.get('2fa_step') === 'confirm') {
			const result = await configure(ctx, backend, fd);
			if (result.ok) {
				await saveTwoFactor(ctx.server, ctx.own, ctx.user, result.config);
				redirect(303, '/server/settings/two-factor?saved=configured');
			}
			const setupView = await setup(ctx, backend, stored.config);
			return fail(400, { error: result.error, configure: backend, setup: setupView });
		}
		const setupView = await setup(ctx, backend, stored.config);
		return { configure: backend, setup: setupView };
	},

	remove: async (event) => {
		const ctx = flowCtx(event);
		const fd = await event.request.formData();
		const stored = await loadTwoFactor(ctx.server, ctx.own, ctx.user);
		if (!stored) return fail(400, { error: 'Two-factor authentication is not available.' });
		const cfg = stored.config;
		if (cfg.backend === '') redirect(303, '/server/settings/two-factor');
		if (fd.get('2fa_step') === 'confirm') {
			const result = await check(ctx, cfg, fd, 'confirm');
			if (result.ok) {
				await saveTwoFactor(ctx.server, ctx.own, ctx.user, NO_TWO_FACTOR);
				redirect(303, '/server/settings/two-factor?saved=removed');
			}
			return fail(401, { error: result.error, confirm: await challenge(ctx, cfg, 'confirm') });
		}
		return { confirm: await challenge(ctx, cfg, 'confirm') };
	}
};
