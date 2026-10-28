import { error } from '@sveltejs/kit';
import { getSecret } from '#lib/server/auth/session.ts';
import { escapeId, escapeQualified } from '#lib/server/db/escape.ts';
import { readSignedClauses } from '#lib/server/table/signed-clause.ts';
import type { RequestHandler } from './$types';

/** Download the raw bytes of one cell (BLOB/binary) of a signed row. */
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
	const filename = `${params.table}-${column}`.replace(/[^\w.-]+/g, '_') + '.bin';
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': 'application/octet-stream',
			'content-disposition': `attachment; filename="${filename}"`,
			'x-content-type-options': 'nosniff'
		}
	});
};
