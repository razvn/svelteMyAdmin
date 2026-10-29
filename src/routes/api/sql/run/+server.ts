import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getSecret } from '#lib/server/auth/session.ts';
import { recordHistory } from '#lib/server/pmadb/history.ts';
import { runScript } from '#lib/server/sql/execute.ts';
import { historyEntries } from '#lib/server/sql/page.ts';
import { attachTransforms } from '#lib/server/transformations/sql-results.ts';
import { createRowKeyResolver } from '#lib/server/sql/row-keys.ts';
import type { RequestHandler } from './$types';

const body = z.object({
	sql: z.string().min(1).max(1_000_000),
	db: z.string().max(64).default(''),
	table: z.string().max(64).default('')
});

/** SQL console: run a script in the context of the current route, JSON in and out. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success || parsed.data.sql.trim() === '')
		error(400, locals.i18n.t('Invalid request'));
	const { sql, db, table } = parsed.data;
	const config = locals.config;
	const dbi = await locals.dbi;
	const result = await runScript(await locals.db, sql, {
		db: db || null,
		maxRows: config.MaxRows,
		maxTotalRows: 200,
		rowKeys: createRowKeyResolver(dbi, getSecret(config.blowfish_secret))
	});
	await attachTransforms(locals, result);
	const scope = db
		? table
			? { level: 'table' as const, db, table }
			: { level: 'db' as const, db }
		: { level: 'server' as const };
	await recordHistory(locals, historyEntries(scope, result));
	return Response.json(result, { headers: { 'cache-control': 'no-store' } });
};
