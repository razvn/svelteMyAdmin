/**
 * Database > Operations (Controllers/Database/OperationsController.php, Operations/CollationController.php,
 * libraries/classes/Operations.php, Relation::getDbComment/setDbComment).
 *
 * Statement planning (`planDatabaseCopy`) is pure and unit-tested; the orchestrators below load a
 * snapshot of the source database, run the plan statement by statement and report every statement
 * that was executed (phpMyAdmin shows the same list as the "SQL query" of the result message).
 */
import type { Connection } from 'mysql2/promise';
import { z } from 'zod';
import { isSystemSchema, parseGrants } from '../admin/databases';
import type { ServerConfig } from '../config/schema';
import { createConnection } from '../db/connection';
import type { DatabaseInterface } from '../db/dbi';
import { escapeId, escapeQualified, escapeString, quoteValue } from '../db/escape';
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/* -------------------------------------------------------------------------------------------
 * Snapshot of a database and statement planning
 * ----------------------------------------------------------------------------------------- */

export interface SnapshotTable {
	name: string;
	/** `SHOW CREATE TABLE` output. */
	createSql: string;
	/** Columns that can be written by `INSERT ... SELECT` (generated columns excluded). */
	columns: string[];
	/** Name of the copy when it differs from `name` (single table copy). */
	targetName?: string;
}

export interface SnapshotNamed {
	name: string;
	createSql: string;
}

export interface SnapshotRoutine extends SnapshotNamed {
	type: 'PROCEDURE' | 'FUNCTION';
}

export interface SnapshotTrigger extends SnapshotNamed {
	table: string;
}

export interface DatabaseSnapshot {
	db: string;
	charset: string;
	collation: string;
	tables: SnapshotTable[];
	views: SnapshotNamed[];
	routines: SnapshotRoutine[];
	events: SnapshotNamed[];
	triggers: SnapshotTrigger[];
}

export type CopyWhat = 'structure' | 'data' | 'dataonly';

export interface CopyOptions {
	/** Rename (move tables, drop the source) instead of copy. */
	move: boolean;
	newName: string;
	what: CopyWhat;
	/** `CREATE DATABASE IF NOT EXISTS` first (always done for a rename). */
	createDatabase: boolean;
	/** `DROP TABLE/VIEW IF EXISTS` in the target before creating. */
	dropTable: boolean;
	/** Keep the `AUTO_INCREMENT=n` table option. */
	autoIncrement: boolean;
	/** Re-create foreign key constraints (copy only; a rename keeps them). */
	constraints: boolean;
}

export interface PlanStep {
	sql: string;
	kind:
		| 'database'
		| 'session'
		| 'trigger'
		| 'table'
		| 'data'
		| 'constraint'
		| 'view'
		| 'routine'
		| 'event';
}

const FK_LINE = /^\s*CONSTRAINT\s+`(?:[^`]|``)+`\s+FOREIGN KEY\s/;

/**
 * Re-target a `SHOW CREATE TABLE` statement: qualify the name with the new database, pull the
 * foreign key constraints out (they are added once every table exists) and drop the
 * `AUTO_INCREMENT=n` table option unless asked to keep it.
 */
export function rewriteCreateTable(
	createSql: string,
	table: string,
	newDb: string,
	opts: { autoIncrement: boolean }
): { create: string; constraints: string[] } {
	const lines = createSql.split('\n');
	const end = lines.findIndex((l, i) => i > 0 && l.startsWith(')'));
	if (!/^CREATE\s/i.test(lines[0]) || end < 0) {
		return { create: createSql, constraints: [] };
	}
	const body = lines.slice(1, end).map((l) => l.replace(/,$/, ''));
	const constraints = body.filter((l) => FK_LINE.test(l)).map((l) => l.trim());
	const kept = body.filter((l) => !FK_LINE.test(l));
	const options = opts.autoIncrement ? lines[end] : lines[end].replace(/\sAUTO_INCREMENT=\d+/, '');
	const head = `CREATE TABLE ${escapeQualified(newDb, table)} (`;
	const create = [head, kept.join(',\n'), options, ...lines.slice(end + 1)]
		.filter((l, i) => i !== 1 || l !== '')
		.join('\n');
	return { create, constraints };
}

/** Qualify references to the old database in a view definition with the new one. */
export function rewriteDefinition(
	sql: string,
	oldDb: string,
	newDb: string,
	knownNames: string[]
): string {
	let out = sql;
	for (const name of knownNames) {
		out = out.replaceAll(
			`${escapeId(oldDb)}.${escapeId(name)}`,
			`${escapeId(newDb)}.${escapeId(name)}`
		);
	}
	return out;
}

/** Order views so that a view comes after the views it selects from (Kahn, cycles keep input order). */
export function orderViews<T extends SnapshotNamed>(views: T[]): T[] {
	const body = (v: T) =>
		v.createSql
			.split(/\sAS\s/i)
			.slice(1)
			.join(' AS ');
	const deps = new Map<string, Set<string>>();
	for (const v of views) {
		const text = body(v);
		deps.set(
			v.name,
			new Set(
				views.filter((o) => o.name !== v.name && text.includes(escapeId(o.name))).map((o) => o.name)
			)
		);
	}
	const done = new Set<string>();
	const out: T[] = [];
	let pending = [...views];
	while (pending.length > 0) {
		const ready = pending.filter((v) => [...deps.get(v.name)!].every((d) => done.has(d)));
		if (ready.length === 0) {
			out.push(...pending);
			break;
		}
		for (const v of ready) {
			out.push(v);
			done.add(v.name);
		}
		pending = pending.filter((v) => !done.has(v.name));
	}
	return out;
}

/**
 * Plan the statements for copying or renaming a database. Order: database, session settings,
 * tables (+ data), foreign keys, views (dependency ordered), routines, events, triggers last so
 * that they do not fire while the data is loaded.
 */
export function planDatabaseCopy(snap: DatabaseSnapshot, opts: CopyOptions): PlanStep[] {
	const { db } = snap;
	const nu = opts.newName;
	const steps: PlanStep[] = [];
	const add = (kind: PlanStep['kind'], sql: string) => steps.push({ kind, sql });
	const copyStructure = opts.move || opts.what !== 'dataonly';
	const copyData = !opts.move && opts.what !== 'structure';
	const defs = !opts.move && opts.what === 'dataonly' ? false : true;

	if (opts.move || opts.createDatabase) {
		let sql = `CREATE DATABASE IF NOT EXISTS ${escapeId(nu)}`;
		if (snap.charset) {
			sql += ` DEFAULT CHARACTER SET ${escapeId(snap.charset)}`;
			if (snap.collation) sql += ` COLLATE ${escapeId(snap.collation)}`;
		}
		add('database', sql);
	}
	add('session', 'SET FOREIGN_KEY_CHECKS = 0');
	add('session', "SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'");

	if (opts.move) {
		// MySQL refuses to move a table that has triggers to another schema
		for (const t of snap.triggers) add('trigger', `DROP TRIGGER ${escapeQualified(db, t.name)}`);
		for (const t of snap.tables) {
			add('table', `RENAME TABLE ${escapeQualified(db, t.name)} TO ${escapeQualified(nu, t.name)}`);
		}
	} else {
		const fkAlters: PlanStep[] = [];
		for (const t of snap.tables) {
			const targetTable = t.targetName ?? t.name;
			const target = escapeQualified(nu, targetTable);
			if (copyStructure) {
				if (opts.dropTable) add('table', `DROP TABLE IF EXISTS ${target}`);
				const { create, constraints } = rewriteCreateTable(t.createSql, targetTable, nu, {
					autoIncrement: opts.autoIncrement
				});
				add('table', create);
				if (opts.constraints && constraints.length > 0) {
					fkAlters.push({
						kind: 'constraint',
						sql: `ALTER TABLE ${target}\n  ${constraints.map((c) => `ADD ${c}`).join(',\n  ')}`
					});
				}
			}
			if (copyData) {
				const cols = t.columns.length > 0 ? t.columns.map(escapeId).join(', ') : '*';
				const list = t.columns.length > 0 ? ` (${cols})` : '';
				add(
					'data',
					`INSERT INTO ${target}${list} SELECT ${cols} FROM ${escapeQualified(db, t.name)}`
				);
			}
		}
		steps.push(...fkAlters);
	}

	if (defs) {
		add('session', `USE ${escapeId(nu)}`);
		const names = [
			...snap.tables.map((t) => t.name),
			...snap.views.map((v) => v.name),
			...snap.routines.map((r) => r.name)
		];
		for (const v of orderViews(snap.views)) {
			if (opts.dropTable && !opts.move) add('view', `DROP VIEW IF EXISTS ${escapeId(v.name)}`);
			add('view', rewriteDefinition(v.createSql, db, nu, names));
		}
		const replace = opts.dropTable && !opts.move;
		for (const r of snap.routines) {
			if (replace) add('routine', `DROP ${r.type} IF EXISTS ${escapeId(r.name)}`);
			add('routine', rewriteDefinition(r.createSql, db, nu, names));
		}
		for (const e of snap.events) {
			if (replace) add('event', `DROP EVENT IF EXISTS ${escapeId(e.name)}`);
			add('event', rewriteDefinition(e.createSql, db, nu, names));
		}
		for (const t of snap.triggers) add('trigger', rewriteDefinition(t.createSql, db, nu, names));
	}
	return steps;
}

/* -------------------------------------------------------------------------------------------
 * Loading
 * ----------------------------------------------------------------------------------------- */

export async function rows(conn: Connection, sql: string, params: unknown[] = []): Promise<Row[]> {
	const [res] = params.length ? await conn.query(sql, params) : await conn.query(sql);
	return res as Row[];
}

async function showCreate(
	conn: Connection,
	what: string,
	qualified: string,
	column: string
): Promise<string | null> {
	const res = await rows(conn, `SHOW CREATE ${what} ${qualified}`);
	const v = res[0]?.[column];
	return typeof v === 'string' && v !== '' ? v : null;
}

/** Collect everything needed to copy or rename `db`. */
export async function loadSnapshot(dbi: DatabaseInterface, db: string): Promise<DatabaseSnapshot> {
	const conn = dbi.conn;
	const schema = await rows(
		conn,
		'SELECT DEFAULT_CHARACTER_SET_NAME AS cs, DEFAULT_COLLATION_NAME AS col ' +
			'FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
		[db]
	);
	const colRows = await rows(
		conn,
		'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, EXTRA AS extra FROM information_schema.COLUMNS ' +
			'WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION',
		[db]
	);
	const columns = new Map<string, string[]>();
	for (const r of colRows) {
		if (/GENERATED/i.test(str(r.extra))) continue;
		const list = columns.get(str(r.t)) ?? [];
		list.push(str(r.c));
		columns.set(str(r.t), list);
	}
	const snap: DatabaseSnapshot = {
		db,
		charset: str(schema[0]?.cs),
		collation: str(schema[0]?.col),
		tables: [],
		views: [],
		routines: [],
		events: [],
		triggers: []
	};
	for (const t of await dbi.listTables(db)) {
		const q = escapeQualified(db, t.name);
		if (t.type === 'VIEW') {
			const sql = await showCreate(conn, 'VIEW', q, 'Create View');
			if (sql) snap.views.push({ name: t.name, createSql: sql });
		} else if (t.type !== 'SYSTEM VIEW') {
			const sql = await showCreate(conn, 'TABLE', q, 'Create Table');
			if (sql)
				snap.tables.push({ name: t.name, createSql: sql, columns: columns.get(t.name) ?? [] });
		}
	}
	for (const r of await dbi.listRoutines(db)) {
		const col = r.type === 'PROCEDURE' ? 'Create Procedure' : 'Create Function';
		const sql = await showCreate(conn, r.type, escapeQualified(db, r.name), col);
		if (sql) snap.routines.push({ name: r.name, type: r.type, createSql: sql });
	}
	for (const e of await dbi.listEvents(db).catch(() => [])) {
		const sql = await showCreate(conn, 'EVENT', escapeQualified(db, e.name), 'Create Event');
		if (sql) snap.events.push({ name: e.name, createSql: sql });
	}
	for (const t of await dbi.listTriggers(db)) {
		const sql = await showCreate(
			conn,
			'TRIGGER',
			escapeQualified(db, t.name),
			'SQL Original Statement'
		);
		if (sql) snap.triggers.push({ name: t.name, table: t.table, createSql: sql });
	}
	return snap;
}

/* -------------------------------------------------------------------------------------------
 * Running
 * ----------------------------------------------------------------------------------------- */

export interface RunResult {
	/** Every statement that was sent to the server, in order. */
	sql: string[];
	/** Set when a statement failed; it is the last entry of `sql`. */
	error?: string;
}

export function messageOf(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Run statements one by one and stop at the first error. */
export async function runStatements(conn: Connection, statements: string[]): Promise<RunResult> {
	const sql: string[] = [];
	for (const s of statements) {
		sql.push(s);
		try {
			await conn.query(s);
		} catch (e) {
			return { sql, error: messageOf(e) };
		}
	}
	return { sql };
}

/** Run `fn` with foreign key checks / sql_mode / current database restored afterwards. */
export async function withSessionRestored<T>(
	dbi: DatabaseInterface,
	db: string,
	fn: () => Promise<T>
) {
	const conn = dbi.conn;
	const [saved] = await rows(
		conn,
		'SELECT @@SESSION.foreign_key_checks AS fk, @@SESSION.sql_mode AS mode'
	);
	try {
		return await fn();
	} finally {
		await conn.query('SET FOREIGN_KEY_CHECKS = ?', [Number(saved?.fk ?? 1)]).catch(() => {});
		await conn.query('SET SESSION sql_mode = ?', [str(saved?.mode)]).catch(() => {});
		await conn.query(`USE ${escapeId(db)}`).catch(() => {});
	}
}

export interface OperationResult extends RunResult {
	ok: boolean;
	message: string;
	/** Name of the database to switch to, if any. */
	goto?: string;
}

const MAX_NAME = 64;

/** Validate a target database name like the PHP controller (non empty, not the same, lower_case_table_names). */
export async function normalizeNewName(
	dbi: DatabaseInterface,
	db: string,
	raw: string,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
	let name = raw;
	if (name.length === 0) return { ok: false, error: tr.t('The database name is empty!') };
	if (name.length > MAX_NAME || name.includes('\0') || /\s$/.test(name)) {
		return { ok: false, error: tr.t('Invalid database name.') };
	}
	const [lc] = await rows(dbi.conn, 'SELECT @@lower_case_table_names AS v');
	if (str(lc?.v) === '1') name = name.toLowerCase();
	if (name === db) {
		return {
			ok: false,
			error: tr.t('Cannot copy database to the same name. Change the name and try again.')
		};
	}
	if (isSystemSchema(name)) return { ok: false, error: tr.t('Invalid database name.') };
	return { ok: true, name };
}

/* ---- privileges ---- */

const PRIV_TABLES = ['db', 'tables_priv', 'columns_priv', 'procs_priv'] as const;

/** Can the user read/write the privilege tables and reload the grants? */
export async function canAdjustPrivileges(dbi: DatabaseInterface): Promise<boolean> {
	try {
		const grants = await rows(dbi.conn, 'SHOW GRANTS FOR CURRENT_USER()');
		const { isSuperUser } = parseGrants(grants.map((r) => str(Object.values(r)[0])));
		if (!isSuperUser) return false;
		for (const t of PRIV_TABLES) await dbi.conn.query(`SELECT 1 FROM mysql.${escapeId(t)} LIMIT 1`);
		return true;
	} catch {
		return false;
	}
}

const escapeUnderscores = (name: string) => name.replaceAll('_', '\\_');

/** Operations::adjustPrivilegesMoveDb / adjustPrivilegesCopyDb. */
export async function adjustPrivileges(
	conn: Connection,
	oldDb: string,
	newDb: string,
	move: boolean
): Promise<RunResult> {
	const from = escapeUnderscores(oldDb);
	const to = escapeUnderscores(newDb);
	const sql: string[] = [];
	try {
		for (const t of PRIV_TABLES) {
			const table = escapeQualified('mysql', t);
			if (move) {
				const stmt = `UPDATE ${table} SET Db = '${escapeString(to)}' WHERE Db = '${escapeString(from)}'`;
				sql.push(stmt);
				await conn.query(stmt);
				continue;
			}
			const existing = await rows(conn, `SELECT * FROM ${table} WHERE Db = ?`, [from]);
			for (const r of existing) {
				const cols = Object.keys(r);
				const stmt =
					`INSERT INTO ${table} (${cols.map(escapeId).join(', ')}) VALUES (` +
					cols.map((c) => quoteValue(c === 'Db' ? to : (r[c] as never))).join(', ') +
					')';
				sql.push(stmt);
				await conn.query(stmt);
			}
		}
		sql.push('FLUSH PRIVILEGES');
		await conn.query('FLUSH PRIVILEGES');
	} catch (e) {
		return { sql, error: messageOf(e) };
	}
	return { sql };
}

/* ---- orchestrators ---- */

export interface CopyInput {
	newName: string;
	what: CopyWhat;
	createDatabase: boolean;
	dropTable: boolean;
	autoIncrement: boolean;
	constraints: boolean;
	adjustPrivileges: boolean;
	switchToNew: boolean;
}

export interface StorageHooks {
	/** Called after a successful rename/copy to duplicate the pmadb database comment/column info. */
	afterCopy?: (oldDb: string, newDb: string, move: boolean) => Promise<string[]>;
}

async function transfer(
	dbi: DatabaseInterface,
	db: string,
	move: boolean,
	input: CopyInput,
	hooks: StorageHooks,
	tr: Translator
): Promise<OperationResult> {
	const named = await normalizeNewName(dbi, db, input.newName, tr);
	if (!named.ok) return { ok: false, message: named.error, sql: [] };
	const newName = named.name;
	if (isSystemSchema(db) && move) {
		return { ok: false, message: tr.t('System databases cannot be renamed.'), sql: [] };
	}
	if (move && (await dbi.databaseExists(newName))) {
		return { ok: false, message: tr.t('Database {name} already exists.', { name: newName }), sql: [] };
	}
	const snap = await loadSnapshot(dbi, db);
	const plan = planDatabaseCopy(snap, {
		move,
		newName,
		what: move ? 'data' : input.what,
		createDatabase: input.createDatabase,
		dropTable: input.dropTable,
		autoIncrement: input.autoIncrement,
		constraints: input.constraints
	});
	const run = await withSessionRestored(dbi, db, () =>
		runStatements(
			dbi.conn,
			plan.map((s) => s.sql)
		)
	);
	const sql = [...run.sql];
	if (run.error) {
		return { ok: false, message: run.error, sql, error: run.error };
	}
	if (input.adjustPrivileges && (await canAdjustPrivileges(dbi))) {
		const adj = await adjustPrivileges(dbi.conn, db, newName, move);
		sql.push(...adj.sql);
		if (adj.error) return { ok: false, message: adj.error, sql, error: adj.error };
	}
	if (hooks.afterCopy) {
		try {
			sql.push(...(await hooks.afterCopy(db, newName, move)));
		} catch {
			// the configuration storage is optional
		}
	}
	if (move) {
		// never drop a database that still holds base tables (something was not moved)
		const left = await rows(
			dbi.conn,
			"SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE <> 'VIEW'",
			[db]
		);
		if (Number(left[0]?.n) > 0) {
			return {
				ok: false,
				message: tr.t('Some tables are still in {db}; it was not dropped.', { db }),
				sql
			};
		}
		const drop = `DROP DATABASE ${escapeId(db)}`;
		sql.push(drop);
		try {
			await dbi.conn.query(drop);
		} catch (e) {
			return { ok: false, message: messageOf(e), sql, error: messageOf(e) };
		}
	}
	return {
		ok: true,
		message: move
			? tr.t('Database {db} has been renamed to {newName}.', { db, newName })
			: tr.t('Database {db} has been copied to {newName}.', { db, newName }),
		sql,
		...(move || input.switchToNew ? { goto: newName } : {})
	};
}

export function renameDatabase(
	dbi: DatabaseInterface,
	db: string,
	input: Pick<CopyInput, 'newName' | 'adjustPrivileges'>,
	hooks: StorageHooks = {},
	tr: Translator = SOURCE_TRANSLATOR
): Promise<OperationResult> {
	return transfer(
		dbi,
		db,
		true,
		{
			...input,
			what: 'data',
			createDatabase: true,
			dropTable: false,
			autoIncrement: true,
			constraints: false,
			switchToNew: true
		},
		hooks,
		tr
	);
}

export function copyDatabase(
	dbi: DatabaseInterface,
	db: string,
	input: CopyInput,
	hooks: StorageHooks = {},
	tr: Translator = SOURCE_TRANSLATOR
): Promise<OperationResult> {
	return transfer(dbi, db, false, input, hooks, tr);
}

/* ---- collation ---- */

export interface CollationInput {
	collation: string;
	changeTables: boolean;
	changeColumns: boolean;
}

/** Operations/CollationController: ALTER DATABASE, optionally every table and its columns. */
export async function changeCollation(
	dbi: DatabaseInterface,
	db: string,
	input: CollationInput,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<OperationResult> {
	const known = (await dbi.listCollations()).find((c) => c.name === input.collation);
	if (!known) return { ok: false, message: tr.t('No collation provided.'), sql: [] };
	const part = `CHARACTER SET ${escapeId(known.charset)} COLLATE ${escapeId(known.name)}`;
	const statements = [`ALTER DATABASE ${escapeId(db)} DEFAULT ${part}`];
	if (input.changeTables) {
		for (const t of await dbi.listTables(db)) {
			if (t.type !== 'BASE TABLE') continue; // the collation of a view cannot be changed
			const q = escapeQualified(db, t.name);
			statements.push(`ALTER TABLE ${q} DEFAULT ${part}`);
			if (input.changeColumns) statements.push(`ALTER TABLE ${q} CONVERT TO ${part}`);
		}
	}
	const run = await runStatements(dbi.conn, statements);
	if (run.error) return { ok: false, message: run.error, ...run };
	return { ok: true, message: tr.t('The collation of {db} has been changed.', { db }), ...run };
}

export async function getDatabaseCollation(dbi: DatabaseInterface, db: string): Promise<string> {
	const r = await rows(
		dbi.conn,
		'SELECT DEFAULT_COLLATION_NAME AS c FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
		[db]
	);
	return str(r[0]?.c);
}

/* -------------------------------------------------------------------------------------------
 * Configuration storage (pma__column_info)
 * ----------------------------------------------------------------------------------------- */

export type StorageServer = Pick<
	ServerConfig,
	| 'host'
	| 'port'
	| 'socket'
	| 'ssl'
	| 'ssl_ca'
	| 'ssl_cert'
	| 'ssl_key'
	| 'ssl_ciphers'
	| 'ssl_verify'
	| 'compress'
	| 'controlhost'
	| 'controlport'
	| 'controluser'
	| 'controlpass'
	| 'pmadb'
	| 'column_info'
	| 'relation'
>;

/** `$db_comment` marker phpMyAdmin stores in `pma__column_info.column_name` for a database comment. */
export const DB_COMMENT_COLUMN = '(db_comment)';

/** Run `fn` on the control connection (or the user connection when no control user is configured). */
export async function withControlConnection<T>(
	dbi: DatabaseInterface,
	server: StorageServer,
	fn: (conn: Connection) => Promise<T>
): Promise<T> {
	if (!server.controluser) return fn(dbi.conn);
	const target = {
		...server,
		host: server.controlhost || server.host,
		port: server.controlport || server.port
	};
	const conn = await createConnection(target, server.controluser, server.controlpass);
	try {
		return await fn(conn);
	} finally {
		await conn.end().catch(() => {});
	}
}

/** Is `pma__column_info` configured and reachable? */
export async function hasColumnInfo(
	dbi: DatabaseInterface,
	server: StorageServer
): Promise<boolean> {
	if (!server.pmadb || !server.column_info) return false;
	try {
		await withControlConnection(dbi, server, (c) =>
			c.query(`SELECT 1 FROM ${escapeQualified(server.pmadb, server.column_info)} LIMIT 1`)
		);
		return true;
	} catch {
		return false;
	}
}

export async function getDbComment(
	dbi: DatabaseInterface,
	server: StorageServer,
	db: string
): Promise<string> {
	const res = await withControlConnection(dbi, server, (c) =>
		rows(
			c,
			`SELECT \`comment\` FROM ${escapeQualified(server.pmadb, server.column_info)} ` +
				"WHERE db_name = ? AND table_name = '' AND column_name = ?",
			[db, DB_COMMENT_COLUMN]
		)
	);
	return str(res[0]?.comment);
}

export async function setDbComment(
	dbi: DatabaseInterface,
	server: StorageServer,
	db: string,
	comment: string
): Promise<RunResult> {
	const table = escapeQualified(server.pmadb, server.column_info);
	const sql =
		comment.length > 0
			? `INSERT INTO ${table} (\`db_name\`, \`table_name\`, \`column_name\`, \`comment\`) VALUES ` +
				`(${quoteValue(db)}, '', ${quoteValue(DB_COMMENT_COLUMN)}, ${quoteValue(comment)}) ` +
				`ON DUPLICATE KEY UPDATE \`comment\` = ${quoteValue(comment)}`
			: `DELETE FROM ${table} WHERE \`db_name\` = ${quoteValue(db)} AND \`table_name\` = '' ` +
				`AND \`column_name\` = ${quoteValue(DB_COMMENT_COLUMN)}`;
	try {
		await withControlConnection(dbi, server, (c) => c.query(sql));
		return { sql: [sql] };
	} catch (e) {
		return { sql: [sql], error: messageOf(e) };
	}
}

/** Move (rename) or duplicate every `pma__column_info` row of a database (comments, MIME types). */
export async function transferColumnInfo(
	dbi: DatabaseInterface,
	server: StorageServer,
	oldDb: string,
	newDb: string,
	move: boolean
): Promise<string[]> {
	if (!(await hasColumnInfo(dbi, server))) return [];
	const table = escapeQualified(server.pmadb, server.column_info);
	const sql = move
		? `UPDATE ${table} SET \`db_name\` = ${quoteValue(newDb)} WHERE \`db_name\` = ${quoteValue(oldDb)}`
		: `INSERT INTO ${table} (\`db_name\`, \`table_name\`, \`column_name\`, \`comment\`, \`mimetype\`, ` +
			'`transformation`, `transformation_options`, `input_transformation`, `input_transformation_options`) ' +
			`SELECT ${quoteValue(newDb)}, \`table_name\`, \`column_name\`, \`comment\`, \`mimetype\`, ` +
			'`transformation`, `transformation_options`, `input_transformation`, `input_transformation_options` ' +
			`FROM ${table} WHERE \`db_name\` = ${quoteValue(oldDb)}`;
	await withControlConnection(dbi, server, (c) => c.query(sql));
	return [sql];
}

/* -------------------------------------------------------------------------------------------
 * Form input
 * ----------------------------------------------------------------------------------------- */

const flag = z
	.union([z.string(), z.null()])
	.optional()
	.transform((v) => v !== null && v !== undefined && v !== '' && v !== '0' && v !== 'false');

export const renameSchema = z.object({
	newname: z.string().max(MAX_NAME + 1),
	adjust_privileges: flag
});

export const copySchema = z.object({
	newname: z.string().max(MAX_NAME + 1),
	what: z.enum(['structure', 'data', 'dataonly']).catch('data'),
	create_database_before_copying: flag,
	drop_if_exists: flag,
	sql_auto_increment: flag,
	add_constraints: flag,
	adjust_privileges: flag,
	switch_to_new: flag
});

export const collationSchema = z.object({
	db_collation: z.string().min(1).max(64),
	change_all_tables_collations: flag,
	change_all_tables_columns_collations: flag
});

/** Read a FormData into a plain object of the first value per key (zod does the parsing). */
export function formToObject(form: FormData): Record<string, string | null> {
	const out: Record<string, string | null> = {};
	for (const key of new Set(form.keys())) {
		const v = form.get(key);
		out[key] = typeof v === 'string' ? v : null;
	}
	return out;
}
