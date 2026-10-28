import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { listColumnNames, listTableNames } from '#lib/server/table/relation.ts';
import type { RequestHandler } from './$types';

const query = z.object({
	db: z.string().min(1).max(64),
	table: z.string().min(1).max(64).optional()
});

/** Dropdown data for the relation forms: `?db=x` lists tables, `?db=x&table=y` lists columns. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const parsed = query.safeParse({
		db: url.searchParams.get('db') ?? '',
		table: url.searchParams.get('table') ?? undefined
	});
	if (!parsed.success) error(400, 'Invalid parameters');
	const dbi = await locals.dbi;
	const { db, table } = parsed.data;
	if (table === undefined) return Response.json({ tables: await listTableNames(dbi, db) });
	return Response.json({ columns: await listColumnNames(dbi, db, table) });
};
