/** Server side of the monitor (libraries/classes/Server/Status/Monitor.php). */
import type { Connection } from 'mysql2/promise';
import { escapeId } from '#lib/server/db/escape.ts';
import {
	processGeneralLog,
	processSlowLog,
	type GeneralLogRow,
	type LogResult,
	type SlowLogRow
} from '#lib/monitor/log.ts';
import { pointKey, type DataPoint, type MonitorDataResponse } from '#lib/monitor/types.ts';

type Row = Record<string, unknown>;

async function varMap(conn: Connection, kind: 'STATUS' | 'VARIABLES', names: string[]) {
	const out = new Map<string, string>();
	if (names.length === 0) return out;
	// Names are validated ([A-Za-z0-9_]) by the endpoint schema; still bound as parameters.
	const [rows] = await conn.query(
		`SHOW GLOBAL ${kind} WHERE Variable_name IN (${names.map(() => '?').join(',')})`,
		names
	);
	for (const r of rows as Row[]) out.set(String(r.Variable_name), String(r.Value ?? ''));
	return out;
}

/** One poll: the current value of every requested point (null when the server does not have it). */
export async function getChartingData(
	conn: Connection,
	points: DataPoint[]
): Promise<MonitorDataResponse> {
	const names = (type: DataPoint['type']) => [
		...new Set(points.filter((p) => p.type === type).map((p) => p.name))
	];
	const [status, servervars] = await Promise.all([
		varMap(conn, 'STATUS', names('statusvar')),
		varMap(conn, 'VARIABLES', names('servervar'))
	]);
	const values: MonitorDataResponse['values'] = {};
	for (const p of points) {
		if (p.type === 'statusvar') values[pointKey(p)] = status.get(p.name) ?? null;
		else if (p.type === 'servervar') values[pointKey(p)] = servervars.get(p.name) ?? null;
		else {
			const [rows] = await conn.query('SHOW PROCESSLIST');
			values[pointKey(p)] = (rows as Row[]).length;
		}
	}
	return { x: Date.now(), values };
}

export const LOGGING_VARS = [
	'general_log',
	'slow_query_log',
	'long_query_time',
	'log_output'
] as const;
export type LoggingVar = (typeof LOGGING_VARS)[number];

export async function getLoggingVars(conn: Connection): Promise<Record<LoggingVar, string>> {
	const m = await varMap(conn, 'VARIABLES', [...LOGGING_VARS]);
	return Object.fromEntries(LOGGING_VARS.map((k) => [k, m.get(k) ?? ''])) as Record<
		LoggingVar,
		string
	>;
}

const LOG_OUTPUT = /^(NONE|(TABLE|FILE)(,(TABLE|FILE))?)$/i;

/** SET GLOBAL for one of the logging variables, with strict value validation. */
export async function setLoggingVar(
	conn: Connection,
	name: LoggingVar,
	value: string
): Promise<Record<LoggingVar, string>> {
	switch (name) {
		case 'general_log':
		case 'slow_query_log': {
			const on = /^(1|on)$/i.test(value);
			if (!on && !/^(0|off)$/i.test(value)) throw new Error(`Invalid value for ${name}`);
			await conn.query(`SET GLOBAL ${name} = ${on ? 1 : 0}`);
			break;
		}
		case 'long_query_time': {
			const n = Number(value);
			if (!Number.isFinite(n) || n < 0 || n > 31536000) throw new Error('Invalid long_query_time');
			await conn.query('SET GLOBAL long_query_time = ?', [n]);
			break;
		}
		case 'log_output':
			if (!LOG_OUTPUT.test(value)) throw new Error('Invalid log_output');
			await conn.query('SET GLOBAL log_output = ?', [value.toUpperCase()]);
			break;
	}
	return getLoggingVars(conn);
}

/** Whether log_output contains TABLE (so mysql.slow_log / general_log are filled). */
export const logsToTable = (vars: Record<LoggingVar, string>) => /table/i.test(vars.log_output);

const LOG_LIMIT = 10_000;

export async function getSlowLog(
	conn: Connection,
	start: number,
	end: number
): Promise<LogResult<SlowLogRow>> {
	const [rows] = await conn.query(
		'SELECT CAST(start_time AS CHAR) AS start_time, user_host, ' +
			'CAST(Sec_to_Time(Sum(Time_to_Sec(query_time))) AS CHAR) AS query_time, ' +
			'CAST(Sec_to_Time(Sum(Time_to_Sec(lock_time))) AS CHAR) AS lock_time, ' +
			'SUM(rows_sent) AS rows_sent, SUM(rows_examined) AS rows_examined, db, ' +
			'CAST(sql_text AS CHAR) AS sql_text, COUNT(sql_text) AS cnt ' +
			'FROM `mysql`.`slow_log` ' +
			'WHERE start_time > FROM_UNIXTIME(?) AND start_time < FROM_UNIXTIME(?) ' +
			'GROUP BY start_time, user_host, db, CAST(sql_text AS CHAR) ORDER BY start_time LIMIT ?',
		[start, end, LOG_LIMIT]
	);
	return processSlowLog(
		(rows as Row[]).map((r) => ({
			start_time: String(r.start_time ?? ''),
			user_host: String(r.user_host ?? ''),
			query_time: String(r.query_time ?? ''),
			lock_time: String(r.lock_time ?? ''),
			rows_sent: Number(r.rows_sent ?? 0),
			rows_examined: Number(r.rows_examined ?? 0),
			db: String(r.db ?? ''),
			sql_text: String(r.sql_text ?? ''),
			count: Number(r.cnt ?? 1)
		}))
	);
}

export async function getGeneralLog(
	conn: Connection,
	start: number,
	end: number,
	limitTypes: boolean,
	groupInserts: boolean
): Promise<LogResult<GeneralLogRow>> {
	const [rows] = await conn.query(
		'SELECT CAST(TIME(event_time) AS CHAR) AS event_time, user_host, thread_id, server_id, ' +
			'CAST(argument AS CHAR) AS argument, COUNT(argument) AS cnt ' +
			'FROM `mysql`.`general_log` ' +
			"WHERE command_type = 'Query' AND event_time > FROM_UNIXTIME(?) AND event_time < FROM_UNIXTIME(?) " +
			(limitTypes ? "AND CAST(argument AS CHAR) REGEXP '^(INSERT|SELECT|UPDATE|DELETE)' " : '') +
			'GROUP BY event_time, user_host, thread_id, server_id, CAST(argument AS CHAR) ' +
			'ORDER BY event_time LIMIT ?',
		[start, end, LOG_LIMIT]
	);
	return processGeneralLog(
		(rows as Row[]).map((r) => ({
			event_time: String(r.event_time ?? ''),
			user_host: String(r.user_host ?? ''),
			thread_id: Number(r.thread_id ?? 0),
			server_id: Number(r.server_id ?? 0),
			argument: String(r.argument ?? ''),
			count: Number(r.cnt ?? 1)
		})),
		groupInserts
	);
}

export interface AnalyzeResult {
	explain: Row[] | null;
	profiling: { seq: number; state: string; duration: number }[] | null;
	error: string | null;
	executed: boolean;
}

/** Statements that are safe to execute for profiling (read only). */
const isSelect = (sql: string) => /^\s*SELECT\b/i.test(sql);

const errText = (e: unknown) =>
	e && typeof e === 'object' && 'sqlMessage' in e
		? String((e as { sqlMessage: unknown }).sqlMessage)
		: e instanceof Error
			? e.message
			: String(e);

/**
 * "Analyse query": EXPLAIN plus, for SELECT statements, a profiled execution (as Monitor::getJsonForQueryAnalyzer,
 * except that non-SELECT statements are never executed, only explained).
 */
export async function analyzeQuery(
	conn: Connection,
	database: string,
	query: string
): Promise<AnalyzeResult> {
	const out: AnalyzeResult = { explain: null, profiling: null, error: null, executed: false };
	try {
		if (database) await conn.query(`USE ${escapeId(database)}`);
		let profiling = false;
		if (isSelect(query)) {
			try {
				await conn.query('SET PROFILING = 1');
				profiling = true;
			} catch {
				/* profiling not supported (MySQL 8.4 removed it) */
			}
			const sql = query.replace(/^(\s*SELECT)/i, '$1 SQL_NO_CACHE');
			await conn.query(sql);
			out.executed = true;
			const [rows] = await conn.query(`EXPLAIN ${sql}`);
			out.explain = rows as Row[];
			if (profiling) {
				const [p] = await conn.query(
					'SELECT seq, state, duration FROM INFORMATION_SCHEMA.PROFILING WHERE QUERY_ID = 1 ORDER BY seq'
				);
				out.profiling = (p as Row[]).map((r) => ({
					seq: Number(r.seq ?? r.SEQ),
					state: String(r.state ?? r.STATE),
					duration: Number(r.duration ?? r.DURATION)
				}));
			}
		} else {
			const [rows] = await conn.query(`EXPLAIN ${query}`);
			out.explain = rows as Row[];
		}
	} catch (e) {
		out.error = errText(e);
	}
	return out;
}
