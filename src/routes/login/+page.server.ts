import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { availableCodes } from '#lib/i18n/catalog.ts';
import { LANG_COOKIE } from '#lib/i18n/languages.ts';
import { matchLanguage } from '#lib/i18n/resolve.ts';
import { EXPIRED_MESSAGE } from '#lib/server/auth/expired.ts';
import { attemptLogin, safeRedirectTarget, serverLabel } from '#lib/server/auth/index.ts';
import type { Actions, PageServerLoad } from './$types';

const loginSchema = z.object({
	username: z.string().max(256),
	password: z.string().max(5000),
	server: z.coerce.number().int().min(1).catch(1),
	pma_servername: z.string().max(300).optional(),
	pma_serverport: z.string().max(10).optional(),
	redirect: z.string().max(2000).optional(),
	lang: z.string().max(20).optional()
});

export const load: PageServerLoad = ({ locals, url }) => {
	const redirectTo = safeRedirectTarget(url.searchParams.get('redirect'));
	// Servers without a login form (config/http) never need this page.
	if (locals.session || locals.server.auth_type !== 'cookie') redirect(303, redirectTo);

	const { config } = locals;
	return {
		expired: url.searchParams.get('expired') === '1',
		expiredMessage: EXPIRED_MESSAGE,
		redirectTo: url.searchParams.get('redirect') ? redirectTo : '',
		servers: config.Servers.map((s, i) => ({
			index: i + 1,
			label: serverLabel(s),
			auth: s.auth_type
		}))
			.filter((s) => s.auth === 'cookie')
			.map(({ index, label }) => ({ index, label })),
		selectedServer: locals.serverIndex,
		allowArbitraryServer: config.AllowArbitraryServer
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, url, locals }) => {
		const form = loginSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!form.success)
			return fail(400, {
				error: 'Invalid request.',
				username: '',
				server: 0,
				host: '',
				port: ''
			});
		const data = form.data;
		// The language chosen on the form (phpMyAdmin also remembers it at login).
		const lang = matchLanguage(data.lang, availableCodes());
		if (lang) {
			cookies.set(LANG_COOKIE, lang, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: url.protocol === 'https:',
				maxAge: 60 * 60 * 24 * 365
			});
		}

		const result = await attemptLogin(
			{ cookies, url, config: locals.config, clientIp: locals.clientIp },
			{
				serverIndex: data.server,
				user: data.username,
				password: data.password,
				host: data.pma_servername,
				port: data.pma_serverport
			}
		);
		if (!result.ok) {
			// Never echo the password back.
			return fail(401, {
				error: result.error,
				username: data.username,
				server: data.server,
				host: data.pma_servername ?? '',
				port: data.pma_serverport ?? ''
			});
		}
		if (result.twoFactor) {
			const target = safeRedirectTarget(data.redirect);
			redirect(
				303,
				target === '/' ? '/login/2fa' : `/login/2fa?redirect=${encodeURIComponent(target)}`
			);
		}
		redirect(303, safeRedirectTarget(data.redirect));
	}
};
