import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { applyHidden } from '#lib/nav/hidden.ts';
import { getDbChildren } from '#lib/server/navigation/children.ts';
import { toNavConfig } from '#lib/server/navigation/config.ts';
import { storageTable } from '#lib/server/pmadb/index.ts';
import { listHiddenItems } from '#lib/server/pmadb/navigation-hiding.ts';
import type { RequestHandler } from './$types';

const paramsSchema = z.object({ db: z.string().min(1).max(64) });

/** Lazy children (tables, views, routines, events) of one database for the navigation tree. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const parsed = paramsSchema.safeParse(params);
	if (!parsed.success) error(400, locals.i18n.t('Invalid database name'));
	const { db } = parsed.data;
	const dbi = await locals.dbi;
	if (!(await dbi.databaseExists(db))) error(404, locals.i18n.t('Database not found'));
	const children = await getDbChildren(dbi, db, toNavConfig(locals.config));
	// Hidden items (pma__navigationhiding) are filtered out of the data, not just the view.
	const canHide = storageTable(locals.server, 'navigationhiding') !== null;
	const hidden = canHide ? await listHiddenItems(locals, db) : undefined;
	const body = hidden
		? { ...applyHidden(children, hidden), canHide: true, hiddenCount: hidden.length }
		: { ...children, canHide: false, hiddenCount: 0 };
	return Response.json(body, { headers: { 'cache-control': 'no-store' } });
};
