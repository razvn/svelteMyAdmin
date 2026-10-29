import { getTableList } from '#lib/server/pmadb/recent-favorite.ts';
import type { RequestHandler } from './$types';

/** Recent and favorite tables of the logged-in user (sidebar "Recent" / "Favorites"). */
export const GET: RequestHandler = async ({ locals }) => {
	const [recent, favorite] = await Promise.all([
		getTableList(locals, 'recent'),
		getTableList(locals, 'favorite')
	]);
	return Response.json(
		{
			recent: recent.tables,
			favorites: favorite.tables,
			persistent: { recent: recent.persistent, favorites: favorite.persistent },
			limits: {
				recent: Math.max(0, locals.config.NumRecentTables),
				favorites: Math.max(0, locals.config.NumFavoriteTables)
			}
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
