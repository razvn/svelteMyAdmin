/**
 * Change tracking in `pma__tracking` (libraries/classes/Tracker.php). All functions take the
 * storage connection `conn` and the qualified table name `q`; statements of the tracked table are
 * read from the user connection `src`.
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { escapeId } from '#lib/server/db/escape.ts';
import {
	analyseStatement,
	formatDate,
	isNoTrack,
	logChunk,
	logComment,
	parseLog,
	phpSerialize,
	phpUnserialize,
	serializeLog,
	TRACKING_STATEMENTS,
	type LogEntry,
	type PhpValue
} from '#lib/tracking/analyse.ts';

export interface TrackingCtx {
	conn: Connection;
	q: string;
	/** Name written in the log (`# log <date> <user>`). */
	user: string;
	server: Pick<
		ServerConfig,
		| 'tracking_version_auto_create'
		| 'tracking_default_statements'
		| 'tracking_add_drop_table'
		| 'tracking_add_drop_view'
		| 'tracking_add_drop_database'
	>;
}

type Row = Record<string, unknown>;

async function rows(ctx: TrackingCtx, sql: string, params: unknown[] = []): Promise<Row[]> {
	const [r] = await ctx.conn.query(sql, params);
	return r as Row[];
}

/** Keep only known statement names (the column is a SET). */
export function normaliseTrackingSet(set: string): string {
	const wanted = new Set(
		set
			.split(',')
			.map((s) => s.trim().toUpperCase())
			.filter(Boolean)
	);
	return TRACKING_STATEMENTS.filter((s) => wanted.has(s)).join(',');
}

export async function isAnyTrackingInProgress(ctx: TrackingCtx, db: string): Promise<boolean> {
	const r = await rows(
		ctx,
		`SELECT 1 AS x FROM ${ctx.q} WHERE tracking_active = 1 AND db_name = ? LIMIT 1`,
		[db]
	);
	return r.length > 0;
}

/** Highest version (optionally one tracking `statement`); -1 when none. */
export async function getVersion(
	ctx: TrackingCtx,
	db: string,
	table: string,
	statement?: string
): Promise<number> {
	let sql = `SELECT MAX(version) AS v FROM ${ctx.q} WHERE db_name = ? AND table_name = ?`;
	const params = [db, table];
	if (statement) {
		sql += ' AND FIND_IN_SET(?, tracking) > 0';
		params.push(statement);
	}
	const r = await rows(ctx, sql, params);
	const v = r[0]?.v;
	return v === null || v === undefined ? -1 : Number(v);
}

/** Is the newest version of the table active? */
export async function isTracked(ctx: TrackingCtx, db: string, table: string): Promise<boolean> {
	const r = await rows(
		ctx,
		`SELECT tracking_active FROM ${ctx.q} WHERE db_name = ? AND table_name = ? ORDER BY version DESC LIMIT 1`,
		[db, table]
	);
	return Number(r[0]?.tracking_active) === 1;
}

const plain = (r: Row): PhpValue => {
	const o: { [k: string]: PhpValue } = {};
	for (const [k, v] of Object.entries(r)) {
		if (k === 'Privileges') continue;
		o[k] = v === null || v === undefined ? null : typeof v === 'number' ? v : String(v);
	}
	return o;
};

async function srcRows(src: Connection, sql: string): Promise<Row[]> {
	const [r] = await src.query(sql);
	return r as Row[];
}

/** Tracker::createVersion: snapshot + CREATE statement, previous version deactivated. */
export async function createVersion(
	ctx: TrackingCtx,
	src: Connection,
	o: { db: string; table: string; version: number; trackingSet?: string; isView?: boolean }
): Promise<boolean> {
	const { db, table } = o;
	const set = normaliseTrackingSet(o.trackingSet || ctx.server.tracking_default_statements);
	const date = formatDate();
	const qualified = `${escapeId(db)}.${escapeId(table)}`;

	const columns = (await srcRows(src, `SHOW FULL COLUMNS FROM ${qualified}`)).map(plain);
	const indexes = (await srcRows(src, `SHOW INDEXES FROM ${qualified}`)).map(plain);
	const snapshot = phpSerialize({ COLUMNS: columns, INDEXES: indexes });

	let createSql = '';
	if (ctx.server.tracking_add_drop_table && !o.isView) {
		createSql += `${logComment(date, ctx.user)}DROP TABLE IF EXISTS ${escapeId(table)};\n`;
	}
	if (ctx.server.tracking_add_drop_view && o.isView) {
		createSql += `${logComment(date, ctx.user)}DROP VIEW IF EXISTS ${escapeId(table)};\n`;
	}
	const [def] = await srcRows(src, `SHOW CREATE ${o.isView ? 'VIEW' : 'TABLE'} ${qualified}`);
	const ddl = String(def?.['Create Table'] ?? def?.['Create View'] ?? '');
	createSql += `${logComment(date, ctx.user)}${ddl};\n`;

	await ctx.conn.query(
		`INSERT INTO ${ctx.q} (db_name, table_name, version, date_created, date_updated, schema_snapshot, schema_sql, data_sql, tracking) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[db, table, o.version, date, date, snapshot, createSql, '\n', set]
	);
	await setActive(ctx, db, table, o.version - 1, false);
	return true;
}

/** Tracker::createDatabaseVersion. */
export async function createDatabaseVersion(
	ctx: TrackingCtx,
	o: { db: string; version: number; query: string; trackingSet?: string }
): Promise<void> {
	const date = formatDate();
	let createSql = '';
	if (ctx.server.tracking_add_drop_database) {
		createSql += `${logComment(date, ctx.user)}DROP DATABASE IF EXISTS ${escapeId(o.db)};\n`;
	}
	createSql += logComment(date, ctx.user) + o.query;
	const set = normaliseTrackingSet(o.trackingSet || 'CREATE DATABASE,ALTER DATABASE,DROP DATABASE');
	await ctx.conn.query(
		`INSERT INTO ${ctx.q} (db_name, table_name, version, date_created, date_updated, schema_snapshot, schema_sql, data_sql, tracking) VALUES (?, '', ?, ?, ?, '', ?, ?, ?)`,
		[o.db, o.version, date, date, createSql, '\n', set]
	);
}

export async function setActive(
	ctx: TrackingCtx,
	db: string,
	table: string,
	version: number,
	active: boolean
): Promise<void> {
	await ctx.conn.query(
		`UPDATE ${ctx.q} SET tracking_active = ? WHERE db_name = ? AND table_name = ? AND version = ?`,
		[active ? 1 : 0, db, table, version]
	);
}

export async function deleteTracking(
	ctx: TrackingCtx,
	db: string,
	table: string,
	version?: number
): Promise<void> {
	let sql = `DELETE FROM ${ctx.q} WHERE db_name = ? AND table_name = ?`;
	const params: (string | number)[] = [db, table];
	if (version) {
		sql += ' AND version = ?';
		params.push(version);
	}
	await ctx.conn.query(sql, params);
}

export interface VersionRow {
	db: string;
	table: string;
	version: number;
	created: string;
	updated: string;
	tracking: string;
	active: boolean;
}

const toVersion = (r: Row): VersionRow => ({
	db: String(r.db_name),
	table: String(r.table_name),
	version: Number(r.version),
	created: String(r.date_created),
	updated: String(r.date_updated),
	tracking: String(r.tracking ?? ''),
	active: Number(r.tracking_active) === 1
});

/** Versions of one table, newest first. */
export async function listVersions(
	ctx: TrackingCtx,
	db: string,
	table: string
): Promise<VersionRow[]> {
	const r = await rows(
		ctx,
		`SELECT * FROM ${ctx.q} WHERE db_name = ? AND table_name = ? ORDER BY version DESC`,
		[db, table]
	);
	return r.map(toVersion);
}

/** Newest version of every tracked table of a database (Tracker::getTrackedTables). */
export async function listTrackedTables(ctx: TrackingCtx, db: string): Promise<VersionRow[]> {
	const r = await rows(
		ctx,
		`SELECT t.* FROM ${ctx.q} t JOIN (SELECT table_name, MAX(version) AS v FROM ${ctx.q} WHERE db_name = ? AND table_name <> '' GROUP BY table_name) m ON t.table_name = m.table_name AND t.version = m.v WHERE t.db_name = ? ORDER BY t.table_name`,
		[db, db]
	);
	return r.map(toVersion);
}

export interface TrackedData {
	tracking: string;
	snapshot: { COLUMNS: Row[]; INDEXES: Row[] };
	ddlog: LogEntry[];
	dmlog: LogEntry[];
	dateFrom: string;
	dateTo: string;
}

/** Tracker::getTrackedData; null when the version does not exist. */
export async function getTrackedData(
	ctx: TrackingCtx,
	db: string,
	table: string,
	version: number
): Promise<TrackedData | null> {
	const r = await rows(
		ctx,
		`SELECT * FROM ${ctx.q} WHERE db_name = ? AND table_name = ? AND version = ? LIMIT 1`,
		[db, table, version]
	);
	const row = r[0];
	if (!row) return null;
	const ddlog = parseLog(row.schema_sql === null ? null : String(row.schema_sql));
	const dmlog = parseLog(row.data_sql === null ? null : String(row.data_sql));
	const dates = [...ddlog, ...dmlog].map((e) => e.date).sort();
	const snap = phpUnserialize(row.schema_snapshot === null ? null : String(row.schema_snapshot));
	const s = (snap && !Array.isArray(snap) && typeof snap === 'object' ? snap : {}) as {
		COLUMNS?: Row[];
		INDEXES?: Row[];
	};
	return {
		tracking: String(row.tracking ?? ''),
		snapshot: { COLUMNS: s.COLUMNS ?? [], INDEXES: s.INDEXES ?? [] },
		ddlog,
		dmlog,
		dateFrom: dates[0] ?? '',
		dateTo: dates[dates.length - 1] ?? ''
	};
}

/** Replace one log (Tracker::changeTrackingData). */
export async function saveLog(
	ctx: TrackingCtx,
	db: string,
	table: string,
	version: number,
	which: 'ddl' | 'dml',
	entries: LogEntry[]
): Promise<void> {
	const col = which === 'ddl' ? 'schema_sql' : 'data_sql';
	await ctx.conn.query(
		`UPDATE ${ctx.q} SET ${escapeId(col)} = ? WHERE db_name = ? AND table_name = ? AND version = ?`,
		[serializeLog(entries), db, table, version]
	);
}

/**
 * Tracker::handleQuery: append a statement that ran on `src` to the active tracking version of
 * the table it touches. Unlike phpMyAdmin, a CREATE with `tracking_version_auto_create` also works
 * when nothing is tracked in the database yet.
 */
export async function handleQuery(
	ctx: TrackingCtx,
	src: Connection,
	currentDb: string | null,
	sql: string
): Promise<void> {
	if (isNoTrack(sql)) return;
	const a = analyseStatement(sql);
	if (!a) return;
	const db = a.db ?? currentDb;
	if (!db) return;
	const isCreate = ['CREATE TABLE', 'CREATE VIEW', 'CREATE DATABASE'].includes(a.identifier);
	const auto = ctx.server.tracking_version_auto_create && isCreate;
	if (!auto && !(await isAnyTrackingInProgress(ctx, db))) return;

	const version = await getVersion(ctx, db, a.table, a.identifier);
	if (version === -1) {
		if (!auto) return;
		if (a.identifier === 'CREATE DATABASE') {
			if ((await getVersion(ctx, db, '')) === -1) {
				await createDatabaseVersion(ctx, {
					db,
					version: 1,
					query: sql.endsWith(';') ? sql : `${sql};\n`
				});
			}
		} else if ((await getVersion(ctx, db, a.table)) === -1) {
			await createVersion(ctx, src, {
				db,
				table: a.table,
				version: 1,
				isView: a.identifier === 'CREATE VIEW'
			});
		}
		return;
	}
	if (!(await isTracked(ctx, db, a.table))) return;

	const col = a.type === 'DDL' ? 'schema_sql' : 'data_sql';
	const chunk = '\n' + logChunk(formatDate(), ctx.user, sql, db);
	let update = `UPDATE ${ctx.q} SET ${escapeId(col)} = CONCAT(COALESCE(${escapeId(col)}, ''), ?), date_updated = ?`;
	const params: (string | number)[] = [chunk, formatDate()];
	if (a.identifier === 'RENAME TABLE' && a.tableAfterRename) {
		update += ', table_name = ?';
		params.push(a.tableAfterRename);
	}
	update +=
		' WHERE FIND_IN_SET(?, tracking) > 0 AND db_name = ? AND table_name = ? AND version = ?';
	params.push(a.identifier, db, a.table, version);
	await ctx.conn.query(update, params);
}
