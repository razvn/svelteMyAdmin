import { error } from '@sveltejs/kit';
import { getSecret } from '#lib/server/auth/session.ts';
import { escapeId, escapeQualified } from '#lib/server/db/escape.ts';
import { readSignedClauses } from '#lib/server/table/signed-clause.ts';
import { loadMime } from '#lib/server/transformations/column-info.ts';
import { chooseContentType, safeFileName } from '#lib/server/transformations/wrapper.ts';
import type { RequestHandler } from './$types';

/**
 * Stream the bytes of one cell of a signed row with a safe Content-Type
 * (phpMyAdmin's /transformation/wrapper). Only allow-listed image types are served inline.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const secret = getSecret(locals.config.blowfish_secret);
	const clauses = readSignedClauses(url, secret, params.db, params.table);
	const column = url.searchParams.get('col');
	if (!clauses || clauses.length !== 1 || !column) error(400, 'Invalid request');

	const dbi = await locals.dbi;
	const columns = await dbi.getColumns(params.db, params.table);
	if (!columns.some((c) => c.field === column)) error(404, 'Unknown column');

	const conn = await locals.db;
	const [rows] = await conn.query(
		`SELECT ${escapeId(column)} AS v FROM ${escapeQualified(params.db, params.table)} WHERE ${clauses[0]} LIMIT 1`
	);
	const row = (rows as { v: unknown }[])[0];
	if (!row || row.v === null) error(404, 'No data');
	const bytes = row.v instanceof Uint8Array ? row.v : Buffer.from(String(row.v));

	const stored = (await loadMime(locals, params.db, params.table))?.get(column)?.mimetype ?? null;
	const { type, inline } = chooseContentType(bytes, url.searchParams.get('ct'), stored);
	const name = safeFileName(url.searchParams.get('cn') ?? '', `${params.table}-${column}`);
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': type,
			'content-length': String(bytes.length),
			'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; img-src 'self'; sandbox",
			'cache-control': 'private, max-age=60'
		}
	});
};
