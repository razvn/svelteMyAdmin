import { error } from '@sveltejs/kit';
import { z } from 'zod';
import {
	bookmarkQuery,
	createBookmark,
	listBookmarks,
	removeBookmark
} from '#lib/server/pmadb/bookmarks.ts';
import { hasRepo } from '#lib/server/storage/index.ts';
import type { RequestHandler } from './$types';

const dbName = z.string().max(64).default('');
const headers = { 'cache-control': 'no-store' };

/** Bookmarks of one database ('' = server level): the user's own and the shared ones. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const db = dbName.parse(url.searchParams.get('db') ?? '');
	const available = hasRepo(locals.server, 'bookmarks');
	const bookmarks = available ? await listBookmarks(locals, db) : undefined;
	return Response.json(
		{ available: bookmarks !== undefined, bookmarks: bookmarks ?? [] },
		{ headers }
	);
};

const create = z.object({
	action: z.literal('create'),
	db: dbName,
	label: z.string().trim().min(1).max(255),
	sql: z.string().min(1).max(1_000_000),
	shared: z.boolean().default(false),
	replace: z.boolean().default(false)
});
const apply = z.object({
	action: z.literal('apply'),
	db: dbName,
	id: z.number().int().positive(),
	variables: z.array(z.string().max(10_000)).max(100).default([])
});

export const POST: RequestHandler = async ({ request, locals }) => {
	const parsed = z
		.discriminatedUnion('action', [create, apply])
		.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, locals.i18n.t('Invalid request'));
	const p = parsed.data;
	if (p.action === 'create') {
		const id = await createBookmark(locals, {
			db: p.db,
			label: p.label,
			query: p.sql,
			shared: p.shared,
			replace: p.replace
		});
		if (id === undefined) error(409, locals.i18n.t('The bookmark storage is not available'));
		return Response.json({ ok: true, id });
	}
	const sql = await bookmarkQuery(locals, p.db, p.id, p.variables);
	if (sql === undefined) error(409, locals.i18n.t('The bookmark storage is not available'));
	if (sql === null) error(404, locals.i18n.t('Bookmark not found'));
	return Response.json({ sql }, { headers });
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	const id = z.coerce.number().int().positive().safeParse(url.searchParams.get('id'));
	if (!id.success) error(400, locals.i18n.t('Invalid bookmark'));
	const removed = await removeBookmark(locals, id.data);
	if (removed === undefined) error(409, locals.i18n.t('The bookmark storage is not available'));
	if (!removed) error(404, locals.i18n.t('Bookmark not found'));
	return Response.json({ ok: true });
};
