/**
 * Foreign keys for browse links: real InnoDB foreign keys (information_schema) plus the
 * configuration storage's `pma__relation` (internal relations), and the display column of the
 * referenced table (`pma__table_info.display_field`).
 */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { withRepo } from '#lib/server/storage/index.ts';
import { columnKind } from '#lib/table/column-kind.ts';

export interface ForeignKey {
	column: string;
	refDb: string;
	refTable: string;
	refColumn: string;
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Single-column foreign keys of `db`.`table` (composite ones cannot be linked per cell). */
export async function listForeignKeys(
	dbi: DatabaseInterface,
	locals: App.Locals,
	db: string,
	table: string
): Promise<ForeignKey[]> {
	const found = new Map<string, ForeignKey>();
	try {
		const [rows] = await dbi.conn.query(
			'SELECT k.CONSTRAINT_NAME AS c, k.COLUMN_NAME AS col, k.REFERENCED_TABLE_SCHEMA AS rdb, ' +
				'k.REFERENCED_TABLE_NAME AS rt, k.REFERENCED_COLUMN_NAME AS rc ' +
				'FROM information_schema.KEY_COLUMN_USAGE k ' +
				'WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL',
			[db, table]
		);
		const list = rows as Row[];
		const perConstraint = new Map<string, number>();
		for (const r of list) perConstraint.set(s(r.c), (perConstraint.get(s(r.c)) ?? 0) + 1);
		for (const r of list) {
			if (perConstraint.get(s(r.c)) !== 1) continue;
			found.set(s(r.col), {
				column: s(r.col),
				refDb: s(r.rdb),
				refTable: s(r.rt),
				refColumn: s(r.rc)
			});
		}
	} catch {
		// no access to information_schema: no links
	}

	const internal = await withRepo(locals, 'relation', (repo) => repo.listForTable(db, table));
	for (const r of internal ?? []) {
		if (!found.has(r.column)) found.set(r.column, r);
	}
	return [...found.values()];
}

/**
 * Display column of a referenced table: the configured `pma__table_info.display_field`, else the
 * first non-key text column (phpMyAdmin picks a descriptive column the same way).
 */
export async function displayColumn(
	dbi: DatabaseInterface,
	locals: App.Locals,
	db: string,
	table: string,
	refColumn: string
): Promise<string | null> {
	const configured = await withRepo(locals, 'tableInfo', (repo) => repo.get(db, table));
	if (configured) return configured;
	try {
		const columns = await dbi.getColumns(db, table);
		const hit = columns.find(
			(c) => c.field !== refColumn && c.key === '' && columnKind(c.type) === 'text'
		);
		return hit?.field ?? null;
	} catch {
		return null;
	}
}

/** `ref_column` => display value for the given key values (one query, errors give an empty map). */
export async function lookupDisplayValues(
	dbi: DatabaseInterface,
	fk: ForeignKey,
	displayCol: string,
	values: string[]
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	if (!values.length || displayCol === fk.refColumn) return out;
	try {
		const table = escapeQualified(fk.refDb, fk.refTable);
		const [rows] = await dbi.conn.query(
			`SELECT \`${fk.refColumn.replaceAll('`', '``')}\` AS k, \`${displayCol.replaceAll('`', '``')}\` AS v ` +
				`FROM ${table} WHERE \`${fk.refColumn.replaceAll('`', '``')}\` IN (?) LIMIT 1000`,
			[values]
		);
		for (const r of rows as Row[]) if (r.v !== null) out.set(s(r.k), s(r.v));
	} catch {
		// referenced table not readable: no tooltips
	}
	return out;
}
