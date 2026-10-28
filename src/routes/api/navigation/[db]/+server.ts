import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDbChildren } from '#lib/server/navigation/children.ts';
import { toNavConfig } from '#lib/server/navigation/config.ts';
import type { RequestHandler } from './$types';

const paramsSchema = z.object({ db: z.string().min(1).max(64) });

/** Lazy children (tables, views, routines, events) of one database for the navigation tree. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const parsed = paramsSchema.safeParse(params);
	if (!parsed.success) error(400, 'Invalid database name');
	const { db } = parsed.data;
	const dbi = await locals.dbi;
	if (!(await dbi.databaseExists(db))) error(404, 'Database not found');
	const children = await getDbChildren(dbi, db, toNavConfig(locals.config));
	return Response.json(children, { headers: { 'cache-control': 'no-store' } });
};
