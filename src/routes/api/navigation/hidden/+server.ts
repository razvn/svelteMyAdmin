import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { HIDDEN_TYPES } from '#lib/nav/hidden.ts';
import { storageTable } from '#lib/server/pmadb/index.ts';
import { hideItem, listHiddenItems, unhideItem } from '#lib/server/pmadb/navigation-hiding.ts';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };
const dbName = z.string().min(1).max(64);

/** Hidden items of one database ("Show hidden items" dialog). */
export const GET: RequestHandler = async ({ url, locals }) => {
	const parsed = dbName.safeParse(url.searchParams.get('db'));
	if (!parsed.success) error(400, locals.i18n.t('Invalid database name'));
	const available = storageTable(locals.server, 'navigationhiding') !== null;
	const items = available ? await listHiddenItems(locals, parsed.data) : undefined;
	return Response.json({ available: items !== undefined, items: items ?? [] }, { headers });
};

const body = z.object({
	db: dbName,
	name: z.string().min(1).max(64),
	type: z.enum(HIDDEN_TYPES as [string, ...string[]]),
	hidden: z.boolean()
});

/** Hide (`hidden: true`) or unhide one navigation item. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, locals.i18n.t('Invalid request'));
	const { db, hidden, ...rest } = parsed.data;
	const item = rest as { name: string; type: (typeof HIDDEN_TYPES)[number] };
	const ok = hidden ? await hideItem(locals, db, item) : await unhideItem(locals, db, item);
	if (!ok) error(409, locals.i18n.t('Hiding navigation items needs the configuration storage'));
	return Response.json({ ok: true }, { headers });
};
