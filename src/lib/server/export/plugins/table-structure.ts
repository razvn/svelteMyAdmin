/**
 * Column definitions and foreign keys of a table for the document formats (odt, pdf),
 * i.e. what ExportOdt::getTableDef / Pdf::getTableDef read through DatabaseInterface/Relation.
 * Relations come from InnoDB foreign keys; comments from the column comments.
 */
import type { Connection } from '#lib/server/db/connection.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';

export interface StructureColumn {
	name: string;
	/** Printable type, e.g. `int unsigned`, `enum('a','b')`. */
	type: string;
	nullable: boolean;
	/** Default as shown by phpMyAdmin: `NULL` for nullable columns without default. */
	default: string;
	comment: string;
}

export interface StructureInfo {
	columns: StructureColumn[];
	/** column name -> `foreign_table (foreign_field)` parts */
	foreigners: Map<string, { table: string; field: string }>;
}

export async function loadStructure(
	conn: Connection,
	db: string,
	table: string
): Promise<StructureInfo> {
	const [cols] = await conn.query(`SHOW FULL COLUMNS FROM ${escapeQualified(db, table)}`);
	const columns = (cols as Record<string, unknown>[]).map((r) => {
		const nullable = String(r.Null) === 'YES';
		const def = r.Default === null || r.Default === undefined ? null : String(r.Default);
		return {
			name: String(r.Field),
			type: String(r.Type ?? ''),
			nullable,
			default: def ?? (nullable ? 'NULL' : ''),
			comment: String(r.Comment ?? '')
		};
	});
	const foreigners = new Map<string, { table: string; field: string }>();
	try {
		const [fks] = await conn.query(
			`SELECT COLUMN_NAME AS c, REFERENCED_TABLE_NAME AS t, REFERENCED_COLUMN_NAME AS f
			 FROM information_schema.KEY_COLUMN_USAGE
			 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
			 ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
			[db, table]
		);
		for (const r of fks as Record<string, unknown>[]) {
			foreigners.set(String(r.c), { table: String(r.t), field: String(r.f) });
		}
	} catch {
		// no access to information_schema: structure without relations
	}
	return { columns, foreigners };
}
