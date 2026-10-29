import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getSchemaCompletion } from '#lib/server/sql/schema.ts';
import type { RequestHandler } from './$types';

const querySchema = z.object({ db: z.string().min(1).max(64) });

/** Tables and columns of one database, for SQL editor autocompletion. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const parsed = querySchema.safeParse({ db: url.searchParams.get('db') ?? '' });
	if (!parsed.success) error(400, locals.i18n.t('Invalid database name'));
	const { db } = parsed.data;
	const dbi = await locals.dbi;
	if (!(await dbi.databaseExists(db))) error(404, locals.i18n.t('Database not found'));
	return Response.json(await getSchemaCompletion(dbi, db), {
		headers: { 'cache-control': 'no-store' }
	});
};
