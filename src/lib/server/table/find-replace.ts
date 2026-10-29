/**
 * Find and replace service: runs the statements of `#lib/sql/find-replace.ts`.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import {
	buildFindReplaceSql,
	isReplaceableType,
	type FindReplaceRequest
} from '#lib/sql/find-replace.ts';
import { N_, SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';

export const requestSchema = z.object({
	column: z.string().min(1),
	find: z.string().min(1, N_('Enter the text to find.')),
	replaceWith: z.string().default(''),
	useRegex: z.boolean().default(false)
});

export interface ReplaceColumn {
	name: string;
	type: string;
}

export async function loadReplaceColumns(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<ReplaceColumn[]> {
	return (await dbi.getColumns(db, table))
		.filter((c) => isReplaceableType(c.type))
		.map((c) => ({ name: c.field, type: c.type }));
}

async function prepare(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	input: z.infer<typeof requestSchema>
) {
	const columns = await loadReplaceColumns(dbi, db, table);
	if (!columns.some((c) => c.name === input.column)) {
		throw new UserError(N_('Choose one of the text columns.'));
	}
	const info = await dbi.getServerInfo();
	const request: FindReplaceRequest = { db, table, ...input };
	try {
		return buildFindReplaceSql(request, {
			isMariaDB: info.serverType === 'MariaDB',
			versionInt: info.versionInt,
			charset: info.charset
		});
	} catch (e) {
		throw new UserError(e instanceof Error ? e.message : N_('Invalid request.'));
	}
}

export class UserError extends Error {}

/** MySQL rejects a bad pattern with a descriptive message; show it, hide anything else. */
export function describeError(e: unknown, tr: Translator = SOURCE_TRANSLATOR): string {
	if (e instanceof UserError) return tr.t(e.message);
	const err = e as { code?: string; sqlMessage?: string };
	if (err?.code?.startsWith('ER_') && err.sqlMessage) return err.sqlMessage;
	return tr.t('The statement could not be executed.');
}

export interface Preview {
	/** Rows holding at least one match. */
	rows: number;
	samples: { original: string; replaced: string; count: number }[];
	/** More distinct values than shown. */
	truncated: boolean;
}

export async function previewReplace(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	input: z.infer<typeof requestSchema>
): Promise<Preview> {
	const sql = await prepare(dbi, db, table, input);
	const [counts] = await dbi.conn.query<RowDataPacket[]>(sql.count.sql, sql.count.params);
	const [rows] = await dbi.conn.query<RowDataPacket[]>(sql.preview.sql, sql.preview.params);
	return {
		rows: Number(counts[0]?.n ?? 0),
		samples: rows.map((r) => ({
			original: String(r.original ?? ''),
			replaced: String(r.replaced ?? ''),
			count: Number(r.n)
		})),
		truncated: rows.length >= 100
	};
}

export async function runReplace(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	input: z.infer<typeof requestSchema>
): Promise<{ affected: number; sql: string }> {
	const sql = await prepare(dbi, db, table, input);
	const [res] = await dbi.conn.query<ResultSetHeader>(sql.update.sql, sql.update.params);
	return { affected: res.affectedRows, sql: sql.update.sql };
}
