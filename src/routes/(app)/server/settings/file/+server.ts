import { loadPrefs } from '#lib/server/preferences/store.ts';
import { exportJson } from '#lib/preferences/logic.ts';
import type { RequestHandler } from './$types';

/** "Save as JSON file": the stored config_data, as phpMyAdmin's ManageController export. */
export const GET: RequestHandler = async ({ locals, cookies, url }) => {
	if (!locals.session) return new Response('Unauthorized', { status: 401 });
	const prefs = await loadPrefs(locals, cookies);
	const host = url.host.replace(/[^A-Za-z0-9._-]/g, '_');
	return new Response(exportJson(prefs.data), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="phpMyAdmin-config-${host}.json"`,
			'cache-control': 'no-store'
		}
	});
};
