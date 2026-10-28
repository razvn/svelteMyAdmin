import { clearHistory, getHistory } from '#lib/server/pmadb/history.ts';
import type { RequestHandler } from './$types';

/** The login's query history, newest first. */
export const GET: RequestHandler = async ({ locals }) =>
	Response.json(
		{ entries: await getHistory(locals), persistent: locals.config.QueryHistoryDB },
		{ headers: { 'cache-control': 'no-store' } }
	);

export const DELETE: RequestHandler = async ({ locals }) => {
	await clearHistory(locals);
	return Response.json({ ok: true });
};
