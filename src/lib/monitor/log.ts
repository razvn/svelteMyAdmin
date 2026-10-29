/**
 * Log analysis post-processing (Monitor::getJsonForLogDataTypeSlow / ...General and the grouping of
 * js/src/server/status/monitor.js). Pure: the server module fetches the rows.
 */
import { formatByteDown } from '#lib/format.ts';

export interface SlowLogRow {
	start_time: string;
	user_host: string;
	query_time: string;
	lock_time: string;
	rows_sent: number;
	rows_examined: number;
	db: string;
	sql_text: string;
	/** How many identical entries were merged by the SQL GROUP BY. */
	count: number;
}

export interface GeneralLogRow {
	event_time: string;
	user_host: string;
	thread_id: number;
	server_id: number;
	argument: string;
	count: number;
}

export interface LogResult<T> {
	rows: T[];
	/** Entries per statement type (select, insert, ...) plus TOTAL. */
	sum: Record<string, number>;
	numRows: number;
}

const MAX_LEN = 220;
const KEEP = 200;

/** First word, lower case: the statement type. */
export function statementType(sql: string): string {
	const m = /^\s*(\w+)/.exec(sql);
	return m ? m[1].toLowerCase() : '';
}

/** Long INSERT / UPDATE texts are cut and annotated with their size. */
export function truncateStatement(sql: string, type = statementType(sql)): string {
	if ((type === 'insert' || type === 'update') && sql.length > MAX_LEN) {
		const size = formatByteDown(sql.length, 2, 2);
		return `${sql.slice(0, KEEP)}... [${size ? size.join(' ') : sql.length}]`;
	}
	return sql;
}

function addSum(sum: Record<string, number>, type: string, n: number) {
	sum[type] = (sum[type] ?? 0) + n;
}

function finish<T>(rows: T[], sum: Record<string, number>): LogResult<T> {
	sum.TOTAL = Object.values(sum).reduce((a, b) => a + b, 0);
	return { rows, sum, numRows: rows.length };
}

export function processSlowLog(rows: SlowLogRow[]): LogResult<SlowLogRow> {
	const sum: Record<string, number> = {};
	const out = rows.map((r) => {
		const type = statementType(r.sql_text);
		addSum(sum, type, r.count);
		return { ...r, sql_text: truncateStatement(r.sql_text, type) };
	});
	return finish(out, sum);
}

/** Table name of `INSERT INTO <name>` (quoted or not). */
export function insertTable(sql: string): string | null {
	const m = /^INSERT\s+INTO\s+(`|'|"|)([^\s`'"(]+)\1/i.exec(sql);
	return m ? m[2] : null;
}

/**
 * General log rows; with `groupInserts` consecutive-or-not INSERTs into the same table collapse into
 * the first one, which gets the summed count and a trailing "..." (as in Monitor.php).
 */
export function processGeneralLog(
	rows: GeneralLogRow[],
	groupInserts: boolean
): LogResult<GeneralLogRow> {
	const sum: Record<string, number> = {};
	const out: GeneralLogRow[] = [];
	const firstIndex = new Map<string, number>();
	for (const raw of rows) {
		const type = statementType(raw.argument);
		addSum(sum, type, raw.count);
		const row = { ...raw };
		if (type === 'insert' && groupInserts) {
			const table = insertTable(row.argument);
			if (table !== null) {
				const first = firstIndex.get(table);
				if (first !== undefined) {
					const head = out[first];
					head.count += row.count;
					if (!head.argument.endsWith('...')) head.argument += '\n...';
					continue;
				}
				firstIndex.set(table, out.length);
			}
		}
		row.argument = truncateStatement(row.argument, type);
		out.push(row);
	}
	return finish(out, sum);
}

/** Replace literals so that queries differing only in values compare equal. */
export function normalizeQuery(sql: string): string {
	return sql
		.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"/g, '?')
		.replace(/\b0x[0-9a-f]+\b/gi, '?')
		.replace(/(?<![\w`.])-?\d+(?:\.\d+)?\b/g, '?')
		.replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, '(?)')
		.replace(/\s+/g, ' ')
		.trim();
}

export interface GroupedQuery {
	query: string;
	count: number;
	/** Sum of query_time in seconds (slow log only). */
	totalTime: number;
	maxTime: number;
	rowsSent: number;
	rowsExamined: number;
}

/** "HH:MM:SS(.ffffff)" -> seconds. */
export function timeToSeconds(t: string): number {
	const m = /^(-?)(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(t.trim());
	if (!m) return Number(t) || 0;
	const s = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
	return m[1] ? -s : s;
}

/** Group by query text (literals ignored when `ignoreValues`), summing count and time. */
export function groupQueries(
	entries: {
		sql: string;
		count: number;
		time?: string;
		rowsSent?: number;
		rowsExamined?: number;
	}[],
	ignoreValues: boolean
): GroupedQuery[] {
	const map = new Map<string, GroupedQuery>();
	for (const e of entries) {
		const key = ignoreValues ? normalizeQuery(e.sql) : e.sql;
		let g = map.get(key);
		if (!g) {
			g = { query: key, count: 0, totalTime: 0, maxTime: 0, rowsSent: 0, rowsExamined: 0 };
			map.set(key, g);
		}
		const t = e.time ? timeToSeconds(e.time) : 0;
		g.count += e.count;
		g.totalTime += t;
		g.maxTime = Math.max(g.maxTime, t);
		g.rowsSent += e.rowsSent ?? 0;
		g.rowsExamined += e.rowsExamined ?? 0;
	}
	return [...map.values()].sort((a, b) => b.totalTime - a.totalTime || b.count - a.count);
}
