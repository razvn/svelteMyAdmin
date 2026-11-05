import { z } from 'zod';
import { clearMarker } from '#lib/server/audit/marker.ts';
import { getAuthPlugin } from '#lib/server/auth/index.ts';
import { findServerIndex } from '#lib/server/discovery/index.ts';
import { redirectResponse } from '#lib/server/auth/plugins/types.ts';
import type { RequestHandler } from './$types';

/** GET never logs out (CSRF-safe): just go to the login page. */
export const GET: RequestHandler = () =>
	new Response(null, { status: 303, headers: { location: '/login' } });

/** A server position (`2`) or discovery id (`k8s:review-123/mysql`). */
const switchSchema = z.object({ server: z.string().min(1).max(300) });

/**
 * POST /logout: clear the session (http auth answers 401, config auth goes home).
 * With a `server` form field (server switcher) it continues with that server:
 * `/login?server=<key>` for cookie servers, `/?server=<key>` otherwise.
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
		peerAddress: locals.peerAddress,
		t: locals.i18n.t
	};
	if (locals.session) locals.audit.write({ event: 'logout' });
	clearMarker(cookies, url.protocol === 'https:');
	const response = getAuthPlugin(locals.server.auth_type).logout(ctx);

	const form = await request.formData().catch(() => null);
	const asked = switchSchema.safeParse(form ? Object.fromEntries(form) : {});
	const index = asked.success ? findServerIndex(locals.config, asked.data.server) : null;
	const target = index === null ? undefined : locals.config.Servers[index - 1];
	if (!asked.success || !target) return response;
	const key = encodeURIComponent(asked.data.server);
	return redirectResponse(
		target.auth_type === 'cookie' ? `/login?server=${key}` : `/?server=${key}`
	);
};
