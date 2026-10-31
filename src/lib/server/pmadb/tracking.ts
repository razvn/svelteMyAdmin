/**
 * Change tracking (libraries/classes/Tracker.php). All functions take a `TrackingCtx` (the tracking
 * repository of the configuration storage); statements of the tracked table are read from the user
 * connection `src`.
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { escapeId } from '#lib/server/db/escape.ts';
import type { TrackingRepo, TrackingVersionRow } from '#lib/server/storage/types.ts';
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
	repo: TrackingRepo;
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

export const isAnyTrackingInProgress = (ctx: TrackingCtx, db: string): Promise<boolean> =>
	ctx.repo.anyActive(db);

/** Highest version (optionally one tracking `statement`); -1 when none. */
export const getVersion = (
	ctx: TrackingCtx,
	db: string,
	table: string,
	statement?: string
): Promise<number> => ctx.repo.maxVersion(db, table, statement);

/** Is the newest version of the table active? */
export const isTracked = (ctx: TrackingCtx, db: string, table: string): Promise<boolean> =>
	ctx.repo.isActive(db, table);

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

	await ctx.repo.insert({
		db,
		table,
		version: o.version,
		created: date,
		updated: date,
		snapshot,
		schemaSql: createSql,
		dataSql: '\n',
		tracking: set
	});
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
	await ctx.repo.insert({
		db: o.db,
		table: '',
		version: o.version,
		created: date,
		updated: date,
		snapshot: '',
		schemaSql: createSql,
		dataSql: '\n',
		tracking: set
	});
}

export const setActive = (
	ctx: TrackingCtx,
	db: string,
	table: string,
	version: number,
	active: boolean
): Promise<void> => ctx.repo.setActive(db, table, version, active);

export const deleteTracking = (
	ctx: TrackingCtx,
	db: string,
	table: string,
	version?: number
): Promise<void> => ctx.repo.delete(db, table, version);

export type VersionRow = TrackingVersionRow;

/** Versions of one table, newest first. */
export const listVersions = (ctx: TrackingCtx, db: string, table: string): Promise<VersionRow[]> =>
	ctx.repo.listVersions(db, table);

/** Newest version of every tracked table of a database (Tracker::getTrackedTables). */
export const listTrackedTables = (ctx: TrackingCtx, db: string): Promise<VersionRow[]> =>
	ctx.repo.listTracked(db);

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
	const row = await ctx.repo.get(db, table, version);
	if (!row) return null;
	const ddlog = parseLog(row.schema_sql);
	const dmlog = parseLog(row.data_sql);
	const dates = [...ddlog, ...dmlog].map((e) => e.date).sort();
	const snap = phpUnserialize(row.schema_snapshot);
	const s = (snap && !Array.isArray(snap) && typeof snap === 'object' ? snap : {}) as {
		COLUMNS?: Row[];
		INDEXES?: Row[];
	};
	return {
		tracking: row.tracking,
		snapshot: { COLUMNS: s.COLUMNS ?? [], INDEXES: s.INDEXES ?? [] },
		ddlog,
		dmlog,
		dateFrom: dates[0] ?? '',
		dateTo: dates[dates.length - 1] ?? ''
	};
}

/** Replace one log (Tracker::changeTrackingData). */
export const saveLog = (
	ctx: TrackingCtx,
	db: string,
	table: string,
	version: number,
	which: 'ddl' | 'dml',
	entries: LogEntry[]
): Promise<void> => ctx.repo.saveLog(db, table, version, which, serializeLog(entries));

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

	await ctx.repo.appendLog({
		db,
		table: a.table,
		version,
		which: a.type === 'DDL' ? 'ddl' : 'dml',
		chunk: '\n' + logChunk(formatDate(), ctx.user, sql, db),
		updated: formatDate(),
		statement: a.identifier,
		renameTo: a.identifier === 'RENAME TABLE' && a.tableAfterRename ? a.tableAfterRename : undefined
	});
}
