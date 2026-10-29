/** Serializable result shapes of the SQL execution engine (shared by server and UI). */
import type { Cell } from '#lib/components/results/format.ts';
import type { ColumnKind } from '#lib/table/column-kind.ts';
import type { Transformed } from '#lib/transformations/types.ts';
import type { StatementKind } from './classify.ts';

export interface FieldMeta {
	/** Name in the result (alias). */
	name: string;
	/** Original column name ('' for expressions). */
	orgName: string;
	table: string;
	/** Original table ('' for expressions / derived tables). */
	orgTable: string;
	db: string;
	/** SQL type name: `int`, `varchar`, `blob`, `varbinary`, ... */
	type: string;
	kind: ColumnKind;
	/** `PRI` / `UNI` / `MUL` / ''. */
	key: string;
	nullable: boolean;
	unsigned: boolean;
}

/** Signed unique condition of a row (`?where=…&sig=…`), like browse. */
export interface RowKey {
	where: string;
	sig: string;
}

export interface ResultSetData {
	fields: FieldMeta[];
	rows: Cell[][];
	/** More rows existed than `maxTotalRows`; the rest was dropped. */
	truncated: boolean;
	/** Present when the result maps to one table with a unique key: one entry per row. */
	keys: RowKey[] | null;
	/** That table (set together with `keys`). */
	source: { db: string; table: string } | null;
	/** Browser display transformations: field index => one entry per row (null = raw cell). */
	transforms?: Record<number, (Transformed | null)[]>;
}

export interface Warning {
	level: string;
	code: number;
	message: string;
}

export interface ProfileRow {
	status: string;
	/** Seconds, as the server prints it. */
	duration: string;
}

export interface PaginationInfo {
	/** 0-based offset of the first row. */
	pos: number;
	size: number;
	/** Row count of the whole query; null when it could not be counted. */
	total: number | null;
	hasMore: boolean;
}

export interface StatementOk {
	ok: true;
	index: number;
	/** As typed. */
	sql: string;
	/** What was sent to the server (LIMIT appended / EXPLAIN prefixed). */
	executedSql: string;
	kind: StatementKind;
	resultSets: ResultSetData[];
	affectedRows: number;
	/** Auto-increment id of the last INSERT, null when none. */
	insertId: string | null;
	/** Server info string (`Rows matched: 1  Changed: 1  Warnings: 0`). */
	info: string;
	warnings: Warning[];
	durationMs: number;
	pagination: PaginationInfo | null;
	profile: ProfileRow[] | null;
}

export interface StatementFail {
	ok: false;
	index: number;
	sql: string;
	executedSql: string;
	kind: StatementKind;
	error: { errno: number; code: string; message: string };
	/** Offending part of `sql` for syntax errors. */
	errorRange: { start: number; end: number } | null;
	durationMs: number;
}

export type StatementResult = StatementOk | StatementFail;

export interface ScriptResult {
	statements: StatementResult[];
	/** A statement failed and the rest of the script was not run. */
	stopped: boolean;
	/** The script ran inside a transaction that was rolled back. */
	rolledBack: boolean;
	totalMs: number;
}

export type SqlScope =
	{ level: 'server' } | { level: 'db'; db: string } | { level: 'table'; db: string; table: string };

export interface SqlPageSettings {
	maxRows: number;
	showSql: boolean;
	maxCharsInSql: number;
	retainQueryBox: boolean;
	limitChars: number;
	order: 'ASC' | 'DESC' | 'SMART';
	sqlQuery: { Edit: boolean; Explain: boolean; Refresh: boolean };
	/** `EXPLAIN FORMAT=TREE` is available (MySQL >= 8.0.16). */
	explainTree: boolean;
	profilingAvailable: boolean;
	dialect: 'mysql' | 'mariadb';
}

export interface SqlRunOptions {
	showQuery: boolean;
	retainQueryBox: boolean;
	rollback: boolean;
	foreignKeyChecks: boolean;
	profiling: boolean;
	continueOnError: boolean;
	delimiter: string;
}

/** Parameters of re-running one statement from its result block. */
export interface ExecParams {
	pos?: number;
	explain?: 'traditional' | 'tree';
	profiling?: boolean;
}
