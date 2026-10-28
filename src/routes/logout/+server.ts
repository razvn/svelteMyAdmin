import { getAuthPlugin } from '#lib/server/auth/index.ts';
import type { RequestHandler } from './$types';

/** GET never logs out (CSRF-safe): just go to the login page. */
export const GET: RequestHandler = () =>
	new Response(null, { status: 303, headers: { location: '/login' } });

/** POST /logout: clear the session (http auth answers 401, config auth goes home). */
export const POST: RequestHandler = ({ request, url, cookies, locals }) => {
	const ctx = {
		request,
		url,
		cookies,
		config: locals.config,
		serverIndex: locals.serverIndex,
		server: locals.server,
		clientIp: locals.clientIp
	};
	return getAuthPlugin(locals.server.auth_type).logout(ctx);
};
