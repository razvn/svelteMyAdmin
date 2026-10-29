import { z } from 'zod';
import { getAuthPlugin } from '#lib/server/auth/index.ts';
import { redirectResponse } from '#lib/server/auth/plugins/types.ts';
import type { RequestHandler } from './$types';

/** GET never logs out (CSRF-safe): just go to the login page. */
export const GET: RequestHandler = () =>
	new Response(null, { status: 303, headers: { location: '/login' } });

const switchSchema = z.object({ server: z.coerce.number().int().min(1) });

/**
 * POST /logout: clear the session (http auth answers 401, config auth goes home).
 * With a `server` form field (server switcher) it continues with that server:
 * `/login?server=N` for cookie servers, `/?server=N` otherwise.
 */
export const POST: RequestHandler = async ({ request, url, cookies, locals }) => {
	const ctx = {
		request,
		url,
		cookies,
		config: locals.config,
		serverIndex: locals.serverIndex,
		server: locals.server,
		clientIp: locals.clientIp,
		t: locals.i18n.t
	};
	const response = getAuthPlugin(locals.server.auth_type).logout(ctx);

	const form = await request.formData().catch(() => null);
	const asked = switchSchema.safeParse(form ? Object.fromEntries(form) : {});
	const target = asked.success ? locals.config.Servers[asked.data.server - 1] : undefined;
	if (!asked.success || !target) return response;
	return redirectResponse(
		target.auth_type === 'cookie'
			? `/login?server=${asked.data.server}`
			: `/?server=${asked.data.server}`
	);
};
