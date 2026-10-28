/** Row level writes behind browse: delete rows and update one cell by signed unique condition. */
import type { Connection, ResultSetHeader } from 'mysql2/promise';
import type { Cell } from '#lib/components/results/format.ts';
import { escapeId, escapeQualified } from '#lib/server/db/escape.ts';
import { fetchRows, toCell, type TableMeta } from '#lib/server/table/browse.ts';

export function deleteStatement(db: string, table: string, clause: string): string {
	return `DELETE FROM ${escapeQualified(db, table)} WHERE ${clause} LIMIT 1`;
}

export type RowActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const errorMessage = (e: unknown): string =>
	e instanceof Error ? e.message.replace(/^[^:]*:\s*/, '') : 'The statement failed.';

/** DELETE … LIMIT 1 for every clause; stops at the first error. */
export async function deleteRows(
	conn: Connection,
	db: string,
	table: string,
	clauses: string[]
): Promise<RowActionResult<{ deleted: number; statements: string[] }>> {
	let deleted = 0;
	const statements: string[] = [];
	for (const clause of clauses) {
		const sql = deleteStatement(db, table, clause);
		try {
			const [res] = await conn.query(sql);
			deleted += (res as ResultSetHeader).affectedRows;
			statements.push(sql);
		} catch (e) {
			return { ok: false, error: errorMessage(e) };
		}
	}
	return { ok: true, deleted, statements };
}

/**
 * `UPDATE … SET col = ? WHERE <clause> LIMIT 1`. Returns the stored value afterwards, or
 * `keyChanged` when the column takes part in the row's unique condition (the row's signed links
 * are then stale and the page must reload).
 */
export async function updateCell(
	conn: Connection,
	db: string,
	table: string,
	meta: TableMeta,
	clause: string,
	column: string,
	value: string | null
): Promise<RowActionResult<{ cell: Cell; keyChanged: boolean; statement: string }>> {
	const idx = meta.columns.findIndex((c) => c.name === column);
	if (idx < 0) return { ok: false, error: `Unknown column ${column}.` };
	const col = meta.columns[idx];
	if (!col.editable) return { ok: false, error: `Column ${column} cannot be edited here.` };
	if (value === null && !col.nullable) return { ok: false, error: `Column ${column} is NOT NULL.` };

	const qualified = escapeQualified(db, table);
	const statement = `UPDATE ${qualified} SET ${escapeId(column)} = ? WHERE ${clause} LIMIT 1`;
	try {
		await conn.query(statement, [value]);
	} catch (e) {
		return { ok: false, error: errorMessage(e) };
	}

	const keyChanged = !meta.hasUniqueKey || meta.condCols[idx].key !== null;
	if (keyChanged) return { ok: true, cell: value, keyChanged, statement };

	try {
		const { rows } = await fetchRows(
			conn,
			`SELECT ${escapeId(column)} FROM ${qualified} WHERE ${clause} LIMIT 1`
		);
		if (!rows.length) return { ok: false, error: 'The row was not found after the update.' };
		return { ok: true, cell: toCell(rows[0][0], meta.condCols[idx]), keyChanged, statement };
	} catch (e) {
		return { ok: false, error: errorMessage(e) };
	}
}
