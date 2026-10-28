/**
 * Server side of Table > Search / Zoom search: column metadata for the "query by example" grid
 * (operators, ENUM values, small foreign-key dropdowns, geometry functions) and the translation of
 * posted form fields into criteria. The WHERE text itself comes from `#lib/sql/table-search.ts`.
 */
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { escapeId, escapeQualified } from '#lib/server/db/escape.ts';
import {
	baseColumnType,
	getGeometryFunctions,
	getTypeClass,
	getTypeOperators,
	GEOMETRY_TYPES,
	isRangeOperator,
	normalizeColumnType,
	parseEnumSetValues,
	type Criterion
} from '#lib/sql/table-search.ts';

export interface ForeignOption {
	value: string;
	label: string;
}

export interface SearchColumn {
	index: number;
	name: string;
	type: string;
	baseType: string;
	collation: string;
	nullable: boolean;
	operators: string[];
	/** ENUM members (multi-select input), null for other types. */
	enumValues: string[] | null;
	isGeometry: boolean;
	geomFuncs: { name: string; params: number }[];
	/** Referenced rows when the column is a single-column FK to a small table. */
	foreign: ForeignOption[] | null;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

async function loadForeignOptions(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	max: number
): Promise<Map<string, ForeignOption[]>> {
	const [fks] = await dbi.conn.query<RowDataPacket[]>(
		'SELECT CONSTRAINT_NAME AS cn, COLUMN_NAME AS col, REFERENCED_TABLE_SCHEMA AS rs, ' +
			'REFERENCED_TABLE_NAME AS rt, REFERENCED_COLUMN_NAME AS rc ' +
			'FROM information_schema.KEY_COLUMN_USAGE ' +
			'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL',
		[db, table]
	);
	const perConstraint = new Map<string, number>();
	for (const r of fks) perConstraint.set(str(r.cn), (perConstraint.get(str(r.cn)) ?? 0) + 1);

	const out = new Map<string, ForeignOption[]>();
	for (const r of fks) {
		if (perConstraint.get(str(r.cn)) !== 1) continue;
		const refDb = str(r.rs);
		const refTable = str(r.rt);
		const refCol = str(r.rc);
		try {
			const qualified = escapeQualified(refDb, refTable);
			const [cnt] = await dbi.conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${qualified}`);
			if (Number(cnt[0]?.n) > max) continue;
			const refColumns = await dbi.getColumns(refDb, refTable);
			const display = refColumns.find(
				(c) => c.field !== refCol && getTypeClass(baseColumnType(c.type)) === 'CHAR'
			);
			const select =
				escapeId(refCol) + (display ? `, ${escapeId(display.field)} AS label` : ", '' AS label");
			const [rows] = await dbi.conn.query<RowDataPacket[]>(
				`SELECT ${select} FROM ${qualified} ORDER BY ${escapeId(refCol)}`
			);
			out.set(
				str(r.col),
				rows.map((row) => {
					const value = str(row[refCol]);
					const label = str(row.label);
					return { value, label: label ? `${value} - ${label}` : value };
				})
			);
		} catch {
			// Not readable (privileges): the plain text input stays.
		}
	}
	return out;
}

/** Columns of the table prepared for the search grid. */
export async function loadSearchColumns(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	foreignMax: number
): Promise<SearchColumn[]> {
	const [columns, info, foreign] = await Promise.all([
		dbi.getColumns(db, table),
		dbi.getServerInfo(),
		loadForeignOptions(dbi, db, table, foreignMax).catch(() => new Map<string, ForeignOption[]>())
	]);
	const isMariaDB = info.serverType === 'MariaDB';
	return columns.map((col, index) => {
		const type = normalizeColumnType(col.type);
		const base = baseColumnType(type);
		const isGeometry = GEOMETRY_TYPES.includes(base.toUpperCase());
		return {
			index,
			name: col.field,
			type,
			baseType: base,
			collation: col.collation ?? '',
			nullable: col.null,
			operators: getTypeOperators(type, col.null),
			enumValues: /^enum/i.test(type) ? parseEnumSetValues(type) : null,
			isGeometry,
			geomFuncs: isGeometry
				? getGeometryFunctions(type, isMariaDB).map((f) => ({ name: f.name, params: f.params }))
				: [],
			foreign: foreign.get(col.field) ?? null
		};
	});
}

/** One row of the posted grid: operator plus its value fields. */
export interface RawCriterion {
	operator: string;
	values: string[];
	value2?: string;
	geomFunc?: string;
}

/**
 * Turn a posted row into a criterion for `column`. The operator must be offered for the column
 * (spatial columns also accept the comparison operators with a geometry function); returns null
 * for anything else, so forged operators never reach the SQL text.
 */
export function toCriterion(column: SearchColumn, raw: RawCriterion): Criterion | null {
	const geomFunc = raw.geomFunc ?? '';
	if (geomFunc && !column.geomFuncs.some((f) => f.name === geomFunc)) return null;
	if (!raw.operator || !column.operators.includes(raw.operator)) return null;
	let value: string | string[];
	if (isRangeOperator(raw.operator)) value = [raw.values[0] ?? '', raw.value2 ?? ''];
	else if (column.enumValues) value = raw.values.filter((v) => v !== '');
	else value = raw.values[0] ?? '';
	return {
		column: column.name,
		type: column.type,
		operator: raw.operator,
		value,
		geomFunc: geomFunc || undefined
	};
}
