/** Table/column names of one database for SQL editor completion (SqlAutoCompleteController). */
import type { DatabaseInterface } from '../db/dbi';

export interface SchemaCompletion {
	tables: Record<string, string[]>;
}

export async function getSchemaCompletion(
	dbi: Pick<DatabaseInterface, 'conn'>,
	db: string
): Promise<SchemaCompletion> {
	const [rows] = await dbi.conn.query(
		'SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col FROM information_schema.COLUMNS ' +
			'WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION',
		[db]
	);
	const tables: Record<string, string[]> = {};
	for (const r of rows as Array<{ tbl: unknown; col: unknown }>) {
		(tables[String(r.tbl)] ??= []).push(String(r.col));
	}
	return { tables };
}
