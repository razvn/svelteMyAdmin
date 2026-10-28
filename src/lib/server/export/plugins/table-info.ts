/**
 * Metadata helpers for the structure-capable export plugins. The pure parts (row parsing, the
 * column type display rule) are unit-tested; the `load*` functions run SHOW/information_schema
 * queries on the export connection, using escaped identifiers and `?` placeholders.
 */
import type { Connection } from '#lib/server/db/connection.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';

type QueryConn = Pick<Connection, 'query'>;
type Row = Record<string, unknown>;

export interface ColumnInfo {
	field: string;
	/** Full column type as SHOW COLUMNS reports it, e.g. `int(10) unsigned`. */
	type: string;
	/** `YES` / `NO`. */
	null: string;
	/** `PRI`, `UNI`, `MUL` or ''. */
	key: string;
	default: string | null;
	extra: string;
	comment: string;
}

export interface TriggerInfo {
	name: string;
	timing: string;
	event: string;
	table: string;
	statement: string;
}

export interface DatabaseInfo {
	charset: string;
	collation: string;
}

const str = (value: unknown): string =>
	value === null || value === undefined ? '' : String(value);
const strOrNull = (value: unknown): string | null =>
	value === null || value === undefined ? null : String(value);

/** Map SHOW FULL COLUMNS rows to ColumnInfo. */
export function parseColumnRows(rows: readonly Row[]): ColumnInfo[] {
	return rows.map((row) => ({
		field: str(row.Field),
		type: str(row.Type),
		null: str(row.Null),
		key: str(row.Key),
		default: strOrNull(row.Default),
		extra: str(row.Extra),
		comment: str(row.Comment)
	}));
}

/**
 * Default shown in structure exports (phpMyAdmin: `if (! isset($row['Default'])) { if
 * ($row['Null'] !== 'NO') $row['Default'] = 'NULL'; }` followed by `?? ''`).
 */
export function displayDefault(column: ColumnInfo): string {
	if (column.default !== null) return column.default;
	return column.null !== 'NO' ? 'NULL' : '';
}

/** `No` / `Yes` label used by the structure exports (`Null == '' || Null === 'NO'`). */
export function nullableLabel(column: ColumnInfo): 'No' | 'Yes' {
	return column.null === '' || column.null === 'NO' ? 'No' : 'Yes';
}

/**
 * Port of the `print_type` computed by phpMyAdmin's `Util::extractColumnSpec()`: lower-cased
 * type with `unsigned`, `zerofill`, the BINARY attribute and compression markers removed;
 * enum/set values are re-spaced as `'a', 'b'`.
 */
export function printColumnType(spec: string): string {
	const bracket = spec.indexOf('(');
	let type: string;
	let inBrackets = '';
	if (bracket > 0) {
		const close = spec.lastIndexOf(')');
		inBrackets = spec.slice(bracket + 1, close === -1 ? spec.length : close).replace(/\s+$/, '');
		type = spec.slice(0, bracket).replace(/\s+$/, '').toLowerCase();
	} else {
		type = (spec.split(' ')[0] ?? '').toLowerCase();
	}
	if (type === 'enum' || type === 'set') {
		return `${type}(${inBrackets.split("','").join("', '")})`;
	}
	let printType = spec.toLowerCase();
	if (printType.includes('binary') && !/binary\(/.test(printType)) {
		printType = printType.replaceAll('binary', '');
	}
	printType = printType.replaceAll('zerofill', '').replaceAll('unsigned', '');
	printType = printType.replaceAll('/*!100301 compressed*/', '');
	return printType.trim();
}

export async function loadColumns(
	conn: QueryConn,
	db: string,
	table: string
): Promise<ColumnInfo[]> {
	const [rows] = await conn.query(`SHOW FULL COLUMNS FROM ${escapeQualified(db, table)}`);
	return parseColumnRows(rows as unknown as Row[]);
}

/** Names of the unique-index columns (phpMyAdmin: `Non_unique == 0`). */
export async function loadUniqueColumns(
	conn: QueryConn,
	db: string,
	table: string
): Promise<string[]> {
	const [rows] = await conn.query(`SHOW INDEX FROM ${escapeQualified(db, table)}`);
	return (rows as unknown as Row[])
		.filter((row) => Number(row.Non_unique) === 0)
		.map((row) => str(row.Column_name));
}

/** `SHOW CREATE TABLE|VIEW` text (second column of the result, as phpMyAdmin reads it). */
export async function loadCreateStatement(
	conn: QueryConn,
	db: string,
	table: string
): Promise<string | null> {
	const [rows] = await conn.query({
		sql: `SHOW CREATE TABLE ${escapeQualified(db, table)}`,
		rowsAsArray: true
	});
	const first = (rows as unknown as unknown[][])[0];
	return first ? str(first[1]) : null;
}

export async function loadTriggers(
	conn: QueryConn,
	db: string,
	table: string
): Promise<TriggerInfo[]> {
	const [rows] = await conn.query(
		'SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event, ' +
			'EVENT_OBJECT_TABLE AS tableName, ACTION_STATEMENT AS statement ' +
			'FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ? ' +
			'ORDER BY TRIGGER_NAME',
		[db, table]
	);
	return (rows as unknown as Row[]).map((row) => ({
		name: str(row.name),
		timing: str(row.timing),
		event: str(row.event),
		table: str(row.tableName),
		statement: str(row.statement)
	}));
}

/** Procedure or function names of a database. */
export async function loadRoutineNames(
	conn: QueryConn,
	db: string,
	kind: 'PROCEDURE' | 'FUNCTION'
): Promise<string[]> {
	const [rows] = await conn.query(
		'SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES ' +
			'WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = ? ORDER BY ROUTINE_NAME',
		[db, kind]
	);
	return (rows as unknown as Row[]).map((row) => str(row.name));
}

export async function loadEventNames(conn: QueryConn, db: string): Promise<string[]> {
	const [rows] = await conn.query(
		'SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME',
		[db]
	);
	return (rows as unknown as Row[]).map((row) => str(row.name));
}

/** `SHOW CREATE PROCEDURE|FUNCTION|EVENT` text (the column named `Create ...`). */
export async function loadObjectDefinition(
	conn: QueryConn,
	db: string,
	kind: 'PROCEDURE' | 'FUNCTION' | 'EVENT',
	name: string
): Promise<string> {
	const [rows] = await conn.query(`SHOW CREATE ${kind} ${escapeQualified(db, name)}`);
	const row = (rows as unknown as Row[])[0] ?? {};
	const key = Object.keys(row).find((column) => column.startsWith('Create '));
	return key ? str(row[key]) : '';
}

export async function loadDatabaseInfo(conn: QueryConn, db: string): Promise<DatabaseInfo> {
	const [rows] = await conn.query(
		'SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation ' +
			'FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1',
		[db]
	);
	const row = (rows as unknown as Row[])[0] ?? {};
	return { charset: str(row.charset), collation: str(row.collation) };
}
