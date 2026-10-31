/**
 * SQLite configuration storage (opt-in `ConfigStorage`): one `node:sqlite` connection per file,
 * opened lazily, WAL mode, schema created on open. Every table is the SQLite port of the matching
 * `pma__*` table of phpMyAdmin's create_tables.sql (same names, same columns) plus a `server`
 * column that is part of the keys, so one file serves all the servers of the config.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/** Bump together with a new step in `migrate`. */
export const SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS pma__bookmark (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	server TEXT NOT NULL,
	dbase TEXT NOT NULL DEFAULT '',
	"user" TEXT NOT NULL DEFAULT '',
	label TEXT NOT NULL DEFAULT '',
	"query" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pma__bookmark_server ON pma__bookmark (server, dbase);
CREATE TABLE IF NOT EXISTS pma__column_info (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	server TEXT NOT NULL,
	db_name TEXT NOT NULL DEFAULT '',
	table_name TEXT NOT NULL DEFAULT '',
	column_name TEXT NOT NULL DEFAULT '',
	"comment" TEXT NOT NULL DEFAULT '',
	mimetype TEXT NOT NULL DEFAULT '',
	transformation TEXT NOT NULL DEFAULT '',
	transformation_options TEXT NOT NULL DEFAULT '',
	input_transformation TEXT NOT NULL DEFAULT '',
	input_transformation_options TEXT NOT NULL DEFAULT '',
	UNIQUE (server, db_name, table_name, column_name)
);
CREATE TABLE IF NOT EXISTS pma__history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	server TEXT NOT NULL,
	username TEXT NOT NULL DEFAULT '',
	db TEXT NOT NULL DEFAULT '',
	"table" TEXT NOT NULL DEFAULT '',
	timevalue TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
	sqlquery TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pma__history_user ON pma__history (server, username, db, "table", timevalue);
CREATE TABLE IF NOT EXISTS pma__pdf_pages (
	server TEXT NOT NULL,
	db_name TEXT NOT NULL DEFAULT '',
	page_nr INTEGER PRIMARY KEY AUTOINCREMENT,
	page_descr TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS pma__pdf_pages_db ON pma__pdf_pages (server, db_name);
CREATE TABLE IF NOT EXISTS pma__recent (
	server TEXT NOT NULL,
	username TEXT NOT NULL,
	"tables" TEXT NOT NULL,
	PRIMARY KEY (server, username)
);
CREATE TABLE IF NOT EXISTS pma__favorite (
	server TEXT NOT NULL,
	username TEXT NOT NULL,
	"tables" TEXT NOT NULL,
	PRIMARY KEY (server, username)
);
CREATE TABLE IF NOT EXISTS pma__table_uiprefs (
	server TEXT NOT NULL,
	username TEXT NOT NULL,
	db_name TEXT NOT NULL,
	table_name TEXT NOT NULL,
	prefs TEXT NOT NULL,
	last_update TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
	PRIMARY KEY (server, username, db_name, table_name)
);
CREATE TABLE IF NOT EXISTS pma__relation (
	server TEXT NOT NULL,
	master_db TEXT NOT NULL DEFAULT '',
	master_table TEXT NOT NULL DEFAULT '',
	master_field TEXT NOT NULL DEFAULT '',
	foreign_db TEXT NOT NULL DEFAULT '',
	foreign_table TEXT NOT NULL DEFAULT '',
	foreign_field TEXT NOT NULL DEFAULT '',
	PRIMARY KEY (server, master_db, master_table, master_field)
);
CREATE INDEX IF NOT EXISTS pma__relation_foreign ON pma__relation (server, foreign_db, foreign_table);
CREATE TABLE IF NOT EXISTS pma__table_coords (
	server TEXT NOT NULL,
	db_name TEXT NOT NULL DEFAULT '',
	table_name TEXT NOT NULL DEFAULT '',
	pdf_page_number INTEGER NOT NULL DEFAULT 0,
	x REAL NOT NULL DEFAULT 0,
	y REAL NOT NULL DEFAULT 0,
	PRIMARY KEY (server, db_name, table_name, pdf_page_number)
);
CREATE TABLE IF NOT EXISTS pma__table_info (
	server TEXT NOT NULL,
	db_name TEXT NOT NULL DEFAULT '',
	table_name TEXT NOT NULL DEFAULT '',
	display_field TEXT NOT NULL DEFAULT '',
	PRIMARY KEY (server, db_name, table_name)
);
CREATE TABLE IF NOT EXISTS pma__tracking (
	server TEXT NOT NULL,
	db_name TEXT NOT NULL,
	table_name TEXT NOT NULL,
	version INTEGER NOT NULL,
	date_created TEXT NOT NULL,
	date_updated TEXT NOT NULL,
	schema_snapshot TEXT NOT NULL,
	schema_sql TEXT,
	data_sql TEXT,
	tracking TEXT DEFAULT NULL,
	tracking_active INTEGER NOT NULL DEFAULT 1,
	PRIMARY KEY (server, db_name, table_name, version)
);
CREATE TABLE IF NOT EXISTS pma__userconfig (
	server TEXT NOT NULL,
	username TEXT NOT NULL,
	timevalue TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
	config_data TEXT NOT NULL,
	PRIMARY KEY (server, username)
);
CREATE TABLE IF NOT EXISTS pma__users (
	server TEXT NOT NULL,
	username TEXT NOT NULL,
	usergroup TEXT NOT NULL,
	PRIMARY KEY (server, username, usergroup)
);
CREATE TABLE IF NOT EXISTS pma__usergroups (
	server TEXT NOT NULL,
	usergroup TEXT NOT NULL,
	tab TEXT NOT NULL,
	allowed TEXT NOT NULL DEFAULT 'N' CHECK (allowed IN ('Y', 'N')),
	PRIMARY KEY (server, usergroup, tab, allowed)
);
CREATE TABLE IF NOT EXISTS pma__navigationhiding (
	server TEXT NOT NULL,
	username TEXT NOT NULL,
	item_name TEXT NOT NULL,
	item_type TEXT NOT NULL,
	db_name TEXT NOT NULL,
	table_name TEXT NOT NULL,
	PRIMARY KEY (server, username, item_name, item_type, db_name, table_name)
);
CREATE TABLE IF NOT EXISTS pma__savedsearches (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	server TEXT NOT NULL,
	username TEXT NOT NULL DEFAULT '',
	db_name TEXT NOT NULL DEFAULT '',
	search_name TEXT NOT NULL DEFAULT '',
	search_data TEXT NOT NULL,
	UNIQUE (server, username, db_name, search_name)
);
CREATE TABLE IF NOT EXISTS pma__central_columns (
	server TEXT NOT NULL,
	db_name TEXT NOT NULL,
	col_name TEXT NOT NULL,
	col_type TEXT NOT NULL,
	col_length TEXT,
	col_collation TEXT NOT NULL,
	"col_isNull" INTEGER NOT NULL,
	col_extra TEXT DEFAULT '',
	col_default TEXT,
	PRIMARY KEY (server, db_name, col_name)
);
CREATE TABLE IF NOT EXISTS pma__designer_settings (
	server TEXT NOT NULL,
	username TEXT NOT NULL,
	settings_data TEXT NOT NULL,
	PRIMARY KEY (server, username)
);
CREATE TABLE IF NOT EXISTS pma__export_templates (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	server TEXT NOT NULL,
	username TEXT NOT NULL,
	export_type TEXT NOT NULL,
	template_name TEXT NOT NULL,
	template_data TEXT NOT NULL,
	UNIQUE (server, username, export_type, template_name)
);
`;

/** Bring a database to `SCHEMA_VERSION`; every step is idempotent. */
export function migrate(db: DatabaseSync): void {
	const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
	let version = Number(row.user_version);
	if (version >= SCHEMA_VERSION) return;
	db.exec('BEGIN IMMEDIATE');
	try {
		if (version < 1) {
			db.exec(SCHEMA_V1);
			version = 1;
		}
		// Future migrations: `if (version < 2) { ...; version = 2; }`
		db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

/** A server's view of an open file: runs statements; repositories scope them with `server`. */
export class SqliteStore {
	readonly db: DatabaseSync;
	readonly server: string;

	constructor(db: DatabaseSync, server: string) {
		this.db = db;
		this.server = server;
	}

	all<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
		return this.db.prepare(sql).all(...params) as T[];
	}

	get<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T | undefined {
		return this.db.prepare(sql).get(...params) as T | undefined;
	}

	/** Returns the number of changed rows and the id of the last inserted row. */
	run(sql: string, ...params: SQLInputValue[]): { changes: number; insertId: number } {
		const r = this.db.prepare(sql).run(...params);
		return { changes: Number(r.changes), insertId: Number(r.lastInsertRowid) };
	}

	/** Run several statements atomically. */
	transaction<T>(fn: () => T): T {
		this.db.exec('BEGIN IMMEDIATE');
		try {
			const out = fn();
			this.db.exec('COMMIT');
			return out;
		} catch (e) {
			this.db.exec('ROLLBACK');
			throw e;
		}
	}
}

const open = new Map<string, DatabaseSync>();

/** The connection to `path` (one per file per process), created and migrated on first use. */
export function openSqlite(path: string): DatabaseSync {
	let db = open.get(path);
	if (db) return db;
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	db = new DatabaseSync(path);
	try {
		db.exec('PRAGMA busy_timeout = 5000');
		if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
		db.exec('PRAGMA synchronous = NORMAL');
		migrate(db);
	} catch (e) {
		db.close();
		throw e;
	}
	open.set(path, db);
	return db;
}

/** Close every open file (tests, graceful shutdown). */
export function closeAllSqlite(): void {
	for (const db of open.values()) db.close();
	open.clear();
}
