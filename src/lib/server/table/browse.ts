/**
 * Table browse data access (Controllers/Sql/SqlController.php + Display/Results.php, data part).
 */
import type { Connection } from 'mysql2/promise';
import type { Cell } from '#lib/components/results/format.ts';
import type { ColumnInfo, DatabaseInterface } from '#lib/server/db/dbi.ts';
import { escapeId, escapeQualified } from '#lib/server/db/escape.ts';
import { signClause } from '#lib/server/table/signed-clause.ts';
import {
	conditionColumns,
	printableBitValue,
	uniqueCondition,
	type ConditionColumn,
	type RowValue
} from '#lib/server/table/unique-condition.ts';
import { isInlineEditable, parseEnumValues, type ColumnKind } from '#lib/table/column-kind.ts';

/** What the grid needs to know about a column. */
export interface BrowseColumn {
	name: string;
	type: string;
	kind: ColumnKind;
	/** `PRI` / `UNI` / `MUL` or ''. */
	key: string;
	comment: string;
	nullable: boolean;
	enumValues: string[];
	editable: boolean;
}

export interface TableMeta {
	columns: BrowseColumn[];
	info: ColumnInfo[];
	condCols: ConditionColumn[];
	/** The table has a primary key or a usable unique key. */
	hasUniqueKey: boolean;
}

export async function loadTableMeta(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<TableMeta> {
	const info = await dbi.getColumns(db, table);
	const indexes = await dbi.getIndexes(db, table);
	const condCols = conditionColumns(info, indexes);
	const columns = info.map((c, i) => ({
		name: c.field,
		type: c.type,
		kind: condCols[i].kind,
		key: c.key,
		comment: c.comment,
		nullable: c.null,
		enumValues:
			condCols[i].kind === 'enum' || condCols[i].kind === 'set' ? parseEnumValues(c.type) : [],
		editable: isInlineEditable(condCols[i].kind)
	}));
	return { columns, info, condCols, hasUniqueKey: condCols.some((c) => c.key !== null) };
}

/** Geometry columns are fetched as WKT (`ST_AsText`), like phpMyAdmin's browse query. */
export function selectList(columns: { name: string; kind: ColumnKind }[]): string {
	if (!columns.some((c) => c.kind === 'geometry')) return '*';
	return columns
		.map((c) =>
			c.kind === 'geometry'
				? `ST_AsText(${escapeId(c.name)}) AS ${escapeId(c.name)}`
				: escapeId(c.name)
		)
		.join(', ');
}

/**
 * FLOAT/DOUBLE come back as the server's own text (exact round trip for the CONCAT() comparison
 * of the unique condition); everything else keeps mysql2's defaults.
 */
type TypeCastField = { type: string; string: () => string | null };
export const typeCast = (field: TypeCastField, next: () => unknown): unknown =>
	field.type === 'FLOAT' || field.type === 'DOUBLE' ? field.string() : next();

export interface RowQuery {
	db: string;
	table: string;
	columns: { name: string; kind: ColumnKind }[];
	where?: string;
	orderBy?: string;
	offset?: number;
	limit?: number;
}

/** The statement phpMyAdmin would show above the result. */
export function buildSelect(q: RowQuery): string {
	return [
		`SELECT ${selectList(q.columns)} FROM ${escapeQualified(q.db, q.table)}`,
		q.where ? `WHERE ${q.where}` : '',
		q.orderBy ?? '',
		q.limit !== undefined ? `LIMIT ${q.offset ?? 0}, ${q.limit}` : ''
	]
		.filter(Boolean)
		.join(' ');
}

export async function fetchRows(
	conn: Connection,
	sql: string
): Promise<{ rows: RowValue[][]; seconds: number }> {
	const start = performance.now();
	const [rows] = await conn.query({ sql, rowsAsArray: true, typeCast } as never);
	return { rows: rows as RowValue[][], seconds: (performance.now() - start) / 1000 };
}

export function toCell(raw: RowValue, col: ConditionColumn): Cell {
	if (raw === null || raw === undefined) return null;
	if (raw instanceof Uint8Array) {
		if (col.kind === 'bit') {
			let n = 0n;
			for (const b of raw) n = (n << 8n) | BigInt(b);
			return printableBitValue(n, col.bitLength ?? 1);
		}
		return { bytes: raw.length, preview: Buffer.from(raw.subarray(0, 16)).toString('hex') };
	}
	return String(raw);
}

export interface BrowseRow {
	cells: Cell[];
	/** Signed unique condition: `?where=…&sig=…`. */
	where: string;
	sig: string;
}

export function toBrowseRows(
	secret: string,
	db: string,
	table: string,
	condCols: ConditionColumn[],
	raw: RowValue[][]
): BrowseRow[] {
	return raw.map((row) => {
		const cond = uniqueCondition(table, condCols, row);
		return {
			cells: row.map((v, i) => toCell(v, condCols[i])),
			where: cond.clause,
			sig: signClause(secret, db, table, cond.clause)
		};
	});
}

export interface Counted {
	total: number;
	/** Estimated (big InnoDB table without a filter), shown as `~N`. */
	approx: boolean;
}

/**
 * Number of rows. Like phpMyAdmin an unfiltered InnoDB table with more than `MaxExactCount`
 * estimated rows is not counted: the `information_schema` estimate is used.
 */
export async function countRows(
	conn: Connection,
	db: string,
	table: string,
	opts: { where?: string; isView: boolean; maxExactCount: number }
): Promise<Counted> {
	if (!opts.where && !opts.isView) {
		const [meta] = await conn.query(
			'SELECT ENGINE AS engine, TABLE_ROWS AS table_rows FROM information_schema.TABLES ' +
				'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
			[db, table]
		);
		const row = (meta as { engine: string | null; table_rows: unknown }[])[0];
		const estimate = row?.table_rows == null ? null : Number(row.table_rows);
		if (
			row &&
			(row.engine === 'InnoDB' || row.engine === 'TokuDB') &&
			estimate !== null &&
			estimate >= opts.maxExactCount
		) {
			return { total: estimate, approx: true };
		}
	}
	const sql =
		`SELECT COUNT(*) AS c FROM ${escapeQualified(db, table)}` +
		(opts.where ? ` WHERE ${opts.where}` : '');
	const [rows] = await conn.query(sql);
	return { total: Number((rows as { c: unknown }[])[0]?.c ?? 0), approx: false };
}
