/**
 * SQL execution engine (libraries/classes/Sql.php): runs a user script on one connection,
 * statement by statement, and describes every outcome in a serializable shape.
 */
import type { Connection, FieldPacket } from 'mysql2/promise';
import type { Cell } from '#lib/components/results/format.ts';
import { splitStatements } from '#lib/server/db/splitter.ts';
import { typeCast } from '#lib/server/table/browse.ts';
import { printableBitValue, type RowValue } from '#lib/server/table/unique-condition.ts';
import { classifyStatement, type StatementKind } from '#lib/sql/classify.ts';
import { appendLimit } from '#lib/sql/limit.ts';
import { locateSyntaxError } from '#lib/sql/messages.ts';
import type {
	FieldMeta,
	PaginationInfo,
	ProfileRow,
	ResultSetData,
	RowKey,
	ScriptResult,
	StatementResult,
	Warning
} from '#lib/sql/run-types.ts';
import { columnKind, type ColumnKind } from '#lib/table/column-kind.ts';

export type { StatementKind };
export * from '#lib/sql/run-types.ts';

/** Resolves signed row conditions for a result (see `row-keys.ts`); null = no row actions. */
export type RowKeyResolver = (
	fields: FieldMeta[],
	rows: RowValue[][]
) => Promise<{ keys: RowKey[]; source: { db: string; table: string } } | null>;

export interface RunOptions {
	/** `USE` this database first. */
	db?: string | null;
	/** Initial delimiter (a `DELIMITER` command in the script still wins). Default `;`. */
	delimiter?: string;
	/** Do not split: the whole script is one statement (refresh / pagination / explain). */
	noSplit?: boolean;
	continueOnError?: boolean;
	/** Run inside `START TRANSACTION` and `ROLLBACK` at the end. */
	rollback?: boolean;
	/** `false` runs `SET foreign_key_checks = 0` first. */
	foreignKeyChecks?: boolean;
	/** `SET profiling = 1` and `SHOW PROFILE` after each statement. */
	profiling?: boolean;
	/** Offset of the first row of a paginated SELECT. */
	pos?: number;
	/** Page size (`MaxRows`). Default 25. */
	maxRows?: number;
	/** Hard cap of rows kept per result set. Default 5000. */
	maxTotalRows?: number;
	/** Run `EXPLAIN` (or `EXPLAIN FORMAT=TREE`) in front of every statement. */
	explain?: 'traditional' | 'tree' | null;
	rowKeys?: RowKeyResolver;
}

export const DEFAULT_MAX_TOTAL_ROWS = 5000;
export const MAX_WARNINGS = 100;

// ---- field metadata ---------------------------------------------------------------------------

const TYPE_NAMES: Record<number, string> = {
	0: 'decimal',
	1: 'tinyint',
	2: 'smallint',
	3: 'int',
	4: 'float',
	5: 'double',
	6: 'null',
	7: 'timestamp',
	8: 'bigint',
	9: 'mediumint',
	10: 'date',
	11: 'time',
	12: 'datetime',
	13: 'year',
	14: 'date',
	15: 'varchar',
	16: 'bit',
	245: 'json',
	246: 'decimal',
	247: 'enum',
	248: 'set',
	249: 'tinyblob',
	250: 'mediumblob',
	251: 'longblob',
	252: 'blob',
	253: 'varchar',
	254: 'char',
	255: 'geometry'
};
const BINARY_CHARSET = 63;
const FLAG_NOT_NULL = 1;
const FLAG_PRI = 2;
const FLAG_UNI = 4;
const FLAG_MUL = 8;
const FLAG_UNSIGNED = 32;
const FLAG_ENUM = 256;
const FLAG_SET = 2048;

type Packet = FieldPacket & { columnType?: number; characterSet?: number; schema?: string };

/** Describe a mysql2 field packet. */
export function describeField(f: FieldPacket): FieldMeta {
	const p = f as Packet;
	const flags = typeof p.flags === 'number' ? p.flags : 0;
	const code = p.columnType ?? p.type ?? 253;
	const binary = (p.characterSet ?? p.charsetNr) === BINARY_CHARSET;
	let type = p.extendedTypeName ?? TYPE_NAMES[code] ?? 'varchar';
	if (code === 254 && flags & FLAG_ENUM) type = 'enum';
	else if (code === 254 && flags & FLAG_SET) type = 'set';
	else if (!binary && /^(tiny|medium|long)?blob$/.test(type)) type = type.replace('blob', 'text');
	else if (binary && code === 253) type = 'varbinary';
	else if (binary && code === 254) type = 'binary';
	let kind: ColumnKind = columnKind(type);
	if (code === 255) kind = 'geometry';
	return {
		name: p.name,
		orgName: p.orgName ?? '',
		table: p.table ?? '',
		orgTable: p.orgTable ?? '',
		db: p.schema ?? p.db ?? '',
		type,
		kind,
		key: flags & FLAG_PRI ? 'PRI' : flags & FLAG_UNI ? 'UNI' : flags & FLAG_MUL ? 'MUL' : '',
		nullable: !(flags & FLAG_NOT_NULL),
		unsigned: !!(flags & FLAG_UNSIGNED)
	};
}

/** Result value => grid cell (binary values only travel as size + hex preview). */
export function encodeCell(raw: RowValue, field: FieldMeta, bits: number): Cell {
	if (raw === null || raw === undefined) return null;
	if (raw instanceof Uint8Array) {
		if (field.kind === 'bit') {
			let n = 0n;
			for (const b of raw) n = (n << 8n) | BigInt(b);
			return printableBitValue(n, bits);
		}
		return { bytes: raw.length, preview: Buffer.from(raw.subarray(0, 16)).toString('hex') };
	}
	return String(raw);
}

// ---- running ----------------------------------------------------------------------------------

interface RawSet {
	fields: FieldPacket[];
	rows: RowValue[][];
}

interface Header {
	affectedRows: number;
	insertId: number | string;
	info: string;
	warningStatus: number;
}

const isHeader = (v: unknown): v is Header =>
	typeof v === 'object' && v !== null && !Array.isArray(v) && 'affectedRows' in v;

/** Split a mysql2 `query()` result into its row sets and the final OK header. */
export function splitResult(
	rows: unknown,
	fields: unknown
): { sets: RawSet[]; header: Header | null } {
	if (Array.isArray(fields) && fields.length && Array.isArray(fields[0])) {
		// Several result sets (CALL): rows[k] is a row list or the trailing OK header.
		const list = rows as unknown[];
		const sets: RawSet[] = [];
		let header: Header | null = null;
		list.forEach((r, k) => {
			if (Array.isArray(fields[k])) {
				sets.push({ fields: fields[k] as FieldPacket[], rows: r as RowValue[][] });
			} else if (isHeader(r)) {
				header = r;
			}
		});
		return { sets, header };
	}
	if (Array.isArray(rows) && Array.isArray(fields)) {
		return {
			sets: [{ fields: fields as FieldPacket[], rows: rows as RowValue[][] }],
			header: null
		};
	}
	return { sets: [], header: isHeader(rows) ? rows : null };
}

interface SqlError {
	errno?: number;
	code?: string;
	sqlMessage?: string;
	message?: string;
}

/** Syntax error location mapped back onto the statement as typed. */
function errorRange(sql: string, executed: string, errno: number, message: string) {
	const r = locateSyntaxError(executed, errno, message);
	if (!r) return null;
	const offset = Math.max(0, executed.indexOf(sql));
	const clamp = (n: number) => Math.min(sql.length, Math.max(0, n - offset));
	return { start: clamp(r.start), end: clamp(r.end) };
}

const hr = () => process.hrtime.bigint();
const msSince = (start: bigint) => Number(hr() - start) / 1e6;

async function fetchWarnings(conn: Connection): Promise<Warning[]> {
	const [rows] = await conn.query({ sql: 'SHOW WARNINGS', rowsAsArray: true });
	return (rows as [string, number, string][])
		.slice(0, MAX_WARNINGS)
		.map(([level, code, message]) => ({
			level: String(level),
			code: Number(code),
			message: String(message)
		}));
}

async function warningCount(conn: Connection): Promise<number> {
	const [rows] = await conn.query({ sql: 'SHOW COUNT(*) WARNINGS', rowsAsArray: true });
	return Number((rows as unknown[][])[0]?.[0] ?? 0);
}

async function fetchProfile(conn: Connection): Promise<ProfileRow[] | null> {
	try {
		const [rows] = await conn.query({ sql: 'SHOW PROFILE', rowsAsArray: true });
		return (rows as [string, string][]).map(([status, duration]) => ({
			status: String(status),
			duration: String(duration)
		}));
	} catch {
		return null;
	}
}

async function countTotal(conn: Connection, sql: string): Promise<number | null> {
	try {
		const [rows] = await conn.query({
			sql: `SELECT COUNT(*) FROM (${sql}\n) AS cnt`,
			rowsAsArray: true
		});
		return Number((rows as unknown[][])[0]?.[0] ?? 0);
	} catch {
		// e.g. duplicate column names in the derived table
		return null;
	}
}

async function runStatement(
	conn: Connection,
	index: number,
	sql: string,
	o: Required<Pick<RunOptions, 'pos' | 'maxRows' | 'maxTotalRows'>> & RunOptions
): Promise<StatementResult> {
	let kind: StatementKind = classifyStatement(sql);
	let executedSql = sql;
	let paginated = false;
	if (o.explain) {
		executedSql = `EXPLAIN ${o.explain === 'tree' ? 'FORMAT=TREE ' : ''}${sql}`;
		kind = 'explain';
	} else if (kind === 'select') {
		const lim = appendLimit(sql, o.pos, o.maxRows);
		executedSql = lim.sql;
		paginated = lim.appended;
	}

	const start = hr();
	let rows: unknown;
	let fields: unknown;
	try {
		[rows, fields] = (await conn.query({
			sql: executedSql,
			rowsAsArray: true,
			typeCast
		} as never)) as [unknown, unknown];
	} catch (e) {
		const err = e as SqlError;
		const errno = err.errno ?? 0;
		const message = err.sqlMessage ?? err.message ?? 'The query failed.';
		return {
			ok: false,
			index,
			sql,
			executedSql,
			kind,
			error: { errno, code: err.code ?? '', message },
			errorRange: errorRange(sql, executedSql, errno, message),
			durationMs: msSince(start)
		};
	}
	const durationMs = msSince(start);

	const { sets, header } = splitResult(rows, fields);

	// Diagnostics first: every later statement would reset them (SHOW PROFILE even adds one).
	let warnings: Warning[] = [];
	const count = header ? header.warningStatus : sets.length ? await warningCount(conn) : 0;
	if (count > 0) warnings = await fetchWarnings(conn);
	const profile = o.profiling ? await fetchProfile(conn) : null;

	const resultSets: ResultSetData[] = [];
	for (const [k, set] of sets.entries()) {
		const metas = set.fields.map(describeField);
		const cap = o.maxTotalRows;
		const truncated = set.rows.length > cap;
		const raw = truncated ? set.rows.slice(0, cap) : set.rows;
		const cells = raw.map((row) =>
			row.map((v, i) => encodeCell(v, metas[i], (set.fields[i] as Packet).columnLength ?? 1))
		);
		let keys: RowKey[] | null = null;
		let source: ResultSetData['source'] = null;
		if (k === 0 && kind === 'select' && o.rowKeys && raw.length) {
			const resolved = await o.rowKeys(metas, raw);
			if (resolved) {
				keys = resolved.keys;
				source = resolved.source;
			}
		}
		resultSets.push({ fields: metas, rows: cells, truncated, keys, source });
	}

	let pagination: PaginationInfo | null = null;
	if (paginated && resultSets[0]) {
		const got = resultSets[0].rows.length;
		let total: number | null;
		if (o.pos === 0 && got < o.maxRows) total = got;
		else total = await countTotal(conn, sql);
		pagination = {
			pos: o.pos,
			size: o.maxRows,
			total,
			hasMore: total === null ? got >= o.maxRows : o.pos + got < total
		};
	}

	return {
		ok: true,
		index,
		sql,
		executedSql,
		kind,
		resultSets,
		affectedRows: header ? Number(header.affectedRows) : 0,
		insertId: header && Number(header.insertId) > 0 ? String(header.insertId) : null,
		info: header?.info ?? '',
		warnings,
		durationMs,
		pagination,
		profile
	};
}

/** Statements of a script (DELIMITER aware). */
export function scriptStatements(script: string, o: Pick<RunOptions, 'delimiter' | 'noSplit'>) {
	if (o.noSplit) {
		const sql = script.trim();
		return sql ? [sql] : [];
	}
	const delim = o.delimiter && o.delimiter !== ';' ? `DELIMITER ${o.delimiter}\n` : '';
	return splitStatements(delim + script).map((s) => s.sql);
}

async function setup(conn: Connection, sql: string): Promise<StatementResult | null> {
	try {
		await conn.query(sql);
		return null;
	} catch (e) {
		const err = e as SqlError;
		return {
			ok: false,
			index: 0,
			sql,
			executedSql: sql,
			kind: 'other',
			error: {
				errno: err.errno ?? 0,
				code: err.code ?? '',
				message: err.sqlMessage ?? err.message ?? ''
			},
			errorRange: null,
			durationMs: 0
		};
	}
}

/**
 * Run a script. One connection, statements in order; stops at the first error unless
 * `continueOnError`. Never throws for SQL errors (they are part of the result).
 */
export async function runScript(
	conn: Connection,
	script: string,
	options: RunOptions = {}
): Promise<ScriptResult> {
	const o = {
		...options,
		pos: Math.max(0, Math.trunc(options.pos ?? 0)),
		maxRows: Math.max(1, Math.trunc(options.maxRows ?? 25)),
		maxTotalRows: Math.max(1, Math.trunc(options.maxTotalRows ?? DEFAULT_MAX_TOTAL_ROWS))
	};
	const total = hr();
	const statements: StatementResult[] = [];
	const finish = (stopped: boolean, rolledBack: boolean): ScriptResult => ({
		statements,
		stopped,
		rolledBack,
		totalMs: msSince(total)
	});

	const prelude: string[] = [];
	if (o.db) prelude.push(`USE \`${o.db.replaceAll('`', '``')}\``);
	if (o.foreignKeyChecks === false) prelude.push('SET foreign_key_checks = 0');
	if (o.profiling) prelude.push('SET profiling = 1');
	for (const sql of prelude) {
		const failed = await setup(conn, sql);
		if (failed) {
			statements.push(failed);
			return finish(true, false);
		}
	}

	if (o.rollback) {
		const failed = await setup(conn, 'START TRANSACTION');
		if (failed) {
			statements.push(failed);
			return finish(true, false);
		}
	}

	let stopped = false;
	for (const sql of scriptStatements(script, o)) {
		const res = await runStatement(conn, statements.length, sql, o);
		statements.push(res);
		if (!res.ok && !o.continueOnError) {
			stopped = true;
			break;
		}
	}

	let rolledBack = false;
	if (o.rollback) {
		rolledBack = (await setup(conn, 'ROLLBACK')) === null;
	}
	return finish(stopped, rolledBack);
}
