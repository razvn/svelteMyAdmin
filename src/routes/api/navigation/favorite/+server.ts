import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getTableList, toggleFavorite } from '#lib/server/pmadb/recent-favorite.ts';
import type { RequestHandler } from './$types';

const body = z.object({
	db: z.string().min(1).max(64),
	table: z.string().min(1).max(64),
	/** Omitted = toggle. */
	favorite: z.boolean().optional()
});

/** Add or remove a favorite table (Database\Structure\FavoriteTableController). */
export const POST: RequestHandler = async ({ request, locals }) => {
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid request');
	const { db, table, favorite } = parsed.data;
	const dbi = await locals.dbi;
	if ((await dbi.getTableType(db, table)) === null) error(404, 'Table not found');
	const result = await toggleFavorite(locals, { db, table }, favorite);
	const { tables } = await getTableList(locals, 'favorite');
	return Response.json(
		{
			result,
			favorites: tables,
			message:
				result === 'full'
					? `You cannot add more than ${locals.config.NumFavoriteTables} favorite tables.`
					: undefined
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
