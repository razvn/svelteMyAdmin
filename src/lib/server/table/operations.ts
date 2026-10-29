/**
 * Table > Operations (Controllers/Table/OperationsController.php, Operations.php,
 * Table::moveCopy / rename). The SQL itself comes from `#lib/sql/table-operations.ts`; the db copy
 * planner and the maintenance executor of Phase 3 (`database/operations.ts`, `database/structure.ts`)
 * are reused for table copies, maintenance, TRUNCATE and DROP.
 */
import type { Connection } from 'mysql2/promise';
import { z } from 'zod';
import { isSystemSchema } from '../admin/databases';
import { listEngines } from '../admin/engines';
import {
	canAdjustPrivileges,
	messageOf,
	planDatabaseCopy,
	rows,
	runStatements,
	withControlConnection,
	withSessionRestored,
	type CopyWhat,
	type DatabaseSnapshot,
	type OperationResult,
	type PlanStep,
	type StorageServer
} from '../database/operations';
import { executePlan, type ExecResult, type Plan, type ResultSet } from '../database/structure';
import type { DatabaseInterface } from '../db/dbi';
import { escapeId, escapeQualified, quoteValue } from '../db/escape';
import {
	MAINTENANCE_ACTIONS,
	PARTITION_OPERATIONS,
	buildDropSql,
	buildMaintenanceSql,
	buildOptionStatements,
	buildPartitionSql,
	buildRemovePartitioningSql,
	buildRenameSql,
	buildReorderSql,
	buildTruncateSql,
	partitionOperationsFor,
	retargetTrigger,
	tableOptionsFromStatus,
	validateTableName,
	type MaintenanceAction,
	type PartitionOperation,
	type TableOptions,
	type TableOptionsRequest
} from '#lib/sql/table-operations.ts';
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/* -------------------------------------------------------------------------------------------
 * Reading
 * ----------------------------------------------------------------------------------------- */

export interface TableStatus {
	isView: boolean;
	options: TableOptions;
	numRows: number | null;
}

/** `Table::getStatusInfo` + `getCreateOptions` from information_schema. */
export async function getTableStatus(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<TableStatus | null> {
	// MySQL 8 caches statistics (AUTO_INCREMENT, rows) for a day by default
	await dbi.conn.query('SET SESSION information_schema_stats_expiry = 0').catch(() => {});
	const r = await rows(
		dbi.conn,
		'SELECT TABLE_TYPE AS ttype, ENGINE AS eng, ROW_FORMAT AS rf, TABLE_COLLATION AS coll, ' +
			'TABLE_COMMENT AS cmt, AUTO_INCREMENT AS ai, CREATE_OPTIONS AS co, TABLE_ROWS AS nrows ' +
			'FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
		[db, table]
	);
	const row = r[0];
	if (!row) return null;
	const isView = str(row.ttype) === 'VIEW' || str(row.ttype) === 'SYSTEM VIEW';
	return {
		isView,
		numRows: row.nrows === null || row.nrows === undefined ? null : Number(row.nrows),
		options: tableOptionsFromStatus({
			engine: isView ? null : (row.eng as string | null),
			comment: isView ? '' : str(row.cmt),
			collation: row.coll as string | null,
			autoIncrement: row.ai as string | number | null,
			rowFormat: row.rf as string | null,
			createOptions: row.co as string | null
		})
	};
}

export interface PartitionInfo {
	names: string[];
	method: string;
}

export async function getPartitions(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<PartitionInfo | null> {
	const r = await rows(
		dbi.conn,
		'SELECT DISTINCT PARTITION_NAME AS pname, PARTITION_METHOD AS pmethod, ' +
			'PARTITION_ORDINAL_POSITION AS pos FROM information_schema.PARTITIONS ' +
			'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND PARTITION_NAME IS NOT NULL ' +
			'ORDER BY PARTITION_ORDINAL_POSITION',
		[db, table]
	);
	if (r.length === 0) return null;
	return { names: r.map((x) => str(x.pname)), method: str(r[0].pmethod) };
}

/** Does InnoDB cluster this table by a user-defined key (PK or NOT NULL UNIQUE)? ORDER BY is moot then. */
export async function hasClusteredKey(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<boolean> {
	const idx = await dbi.getIndexes(db, table);
	const byName = Map.groupBy(idx, (i) => i.keyName);
	for (const [name, parts] of byName) {
		if (name === 'PRIMARY') return true;
		if (parts[0].nonUnique) continue;
		if (parts.every((p) => !p.nullable)) return true;
	}
	return false;
}

export async function hasForeignKeys(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<boolean> {
	const r = await rows(
		dbi.conn,
		'SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? ' +
			"AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
		[db, table]
	);
	return Number(r[0]?.n) > 0;
}

export async function listUsableEngines(dbi: DatabaseInterface): Promise<string[]> {
	return (await listEngines(dbi.conn))
		.filter((e) => e.support === 'YES' || e.support === 'DEFAULT')
		.map((e) => e.name);
}

/* -------------------------------------------------------------------------------------------
 * Table copy planning (pure) on top of the database copy planner
 * ----------------------------------------------------------------------------------------- */

export interface TableCopySource {
	db: string;
	table: string;
	/** `SHOW CREATE TABLE` output. */
	createSql: string;
	/** Columns that `INSERT ... SELECT` can write (generated columns excluded). */
	columns: string[];
	/** `SQL Original Statement` of every trigger of the table. */
	triggers: { name: string; createSql: string }[];
}

export interface TableCopyOptions {
	targetDb: string;
	targetTable: string;
	what: CopyWhat;
	dropTable: boolean;
	autoIncrement: boolean;
	constraints: boolean;
}

/**
 * Statements that copy one table. Triggers are re-created only for a copy into another database
 * (trigger names are unique per database) and only when the structure is copied.
 */
export function planTableCopy(src: TableCopySource, opts: TableCopyOptions): PlanStep[] {
	const sameDb = src.db === opts.targetDb;
	const snap: DatabaseSnapshot = {
		db: src.db,
		charset: '',
		collation: '',
		tables: [
			{
				name: src.table,
				targetName: opts.targetTable,
				createSql: src.createSql,
				columns: src.columns
			}
		],
		views: [],
		routines: [],
		events: [],
		triggers:
			sameDb || opts.what === 'dataonly'
				? []
				: src.triggers.map((t) => ({
						name: t.name,
						table: opts.targetTable,
						createSql: retargetTrigger(t.createSql, opts.targetTable)
					}))
	};
	const steps = planDatabaseCopy(snap, {
		move: false,
		newName: opts.targetDb,
		what: opts.what,
		createDatabase: false,
		dropTable: opts.dropTable,
		autoIncrement: opts.autoIncrement,
		constraints: opts.constraints
	});
	// constraint names are unique per database: within one, let the server name the copies
	// (phpMyAdmin drops the names as well)
	return sameDb
		? steps.map((s) =>
				s.kind === 'constraint'
					? {
							...s,
							sql: s.sql.replace(/ADD CONSTRAINT `(?:[^`]|``)+` FOREIGN KEY/g, 'ADD FOREIGN KEY')
						}
					: s
			)
		: steps;
}

async function loadCopySource(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<TableCopySource | null> {
	const q = escapeQualified(db, table);
	const create = (await rows(dbi.conn, `SHOW CREATE TABLE ${q}`))[0]?.['Create Table'];
	if (typeof create !== 'string') return null;
	const cols = await rows(
		dbi.conn,
		'SELECT COLUMN_NAME AS c, EXTRA AS extra FROM information_schema.COLUMNS ' +
			'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
		[db, table]
	);
	return {
		db,
		table,
		createSql: create,
		columns: cols.filter((c) => !/GENERATED/i.test(str(c.extra))).map((c) => str(c.c)),
		triggers: await loadTriggers(dbi, db, table)
	};
}

async function loadTriggers(dbi: DatabaseInterface, db: string, table: string) {
	const out: { name: string; createSql: string }[] = [];
	for (const t of (await dbi.listTriggers(db)).filter((x) => x.table === table)) {
		const r = await rows(dbi.conn, `SHOW CREATE TRIGGER ${escapeQualified(db, t.name)}`);
		const sql = r[0]?.['SQL Original Statement'];
		if (typeof sql === 'string' && sql !== '') out.push({ name: t.name, createSql: sql });
	}
	return out;
}

/* -------------------------------------------------------------------------------------------
 * Privileges and configuration storage
 * ----------------------------------------------------------------------------------------- */

const TABLE_PRIV_TABLES = ['tables_priv', 'columns_priv'] as const;

/** Operations::adjustPrivilegesRenameOrMoveTable / adjustPrivilegesCopyTable. */
export async function adjustTablePrivileges(
	conn: Connection,
	from: { db: string; table: string },
	to: { db: string; table: string },
	move: boolean
): Promise<{ sql: string[]; error?: string }> {
	const sql: string[] = [];
	try {
		for (const t of TABLE_PRIV_TABLES) {
			const name = escapeQualified('mysql', t);
			if (move) {
				const stmt =
					`UPDATE ${name} SET Db = ${quoteValue(to.db)}, Table_name = ${quoteValue(to.table)} ` +
					`WHERE Db = ${quoteValue(from.db)} AND Table_name = ${quoteValue(from.table)}`;
				sql.push(stmt);
				await conn.query(stmt);
				continue;
			}
			const existing = await rows(conn, `SELECT * FROM ${name} WHERE Db = ? AND Table_name = ?`, [
				from.db,
				from.table
			]);
			for (const r of existing) {
				const cols = Object.keys(r);
				const stmt =
					`INSERT INTO ${name} (${cols.map(escapeId).join(', ')}) VALUES (` +
					cols
						.map((c) =>
							quoteValue(c === 'Db' ? to.db : c === 'Table_name' ? to.table : (r[c] as never))
						)
						.join(', ') +
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

export type TableMetaServer = StorageServer & { table_info: string };

/** Is the configuration storage table `name` configured and reachable? */
async function hasPmaTable(
	dbi: DatabaseInterface,
	server: TableMetaServer,
	name: string
): Promise<boolean> {
	if (!server.pmadb || !name) return false;
	try {
		await withControlConnection(dbi, server, (c) =>
			c.query(`SELECT 1 FROM ${escapeQualified(server.pmadb, name)} LIMIT 1`)
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * Relation::renameTable (move) / Table::moveCopy (copy): carry the column comments + MIME types
 * (`pma__column_info`), the display column (`pma__table_info`) and the internal relations
 * (`pma__relation`) over to the renamed / copied table.
 */
export async function transferTableMeta(
	dbi: DatabaseInterface,
	server: TableMetaServer,
	from: { db: string; table: string },
	to: { db: string; table: string },
	move: boolean
): Promise<string[]> {
	const statements: string[] = [];
	const qv = quoteValue;
	const f = { db: qv(from.db), table: qv(from.table) };
	const t = { db: qv(to.db), table: qv(to.table) };
	if (await hasPmaTable(dbi, server, server.column_info)) {
		const tbl = escapeQualified(server.pmadb, server.column_info);
		statements.push(
			move
				? `UPDATE ${tbl} SET \`db_name\` = ${t.db}, \`table_name\` = ${t.table} ` +
						`WHERE \`db_name\` = ${f.db} AND \`table_name\` = ${f.table}`
				: `INSERT IGNORE INTO ${tbl} (\`db_name\`, \`table_name\`, \`column_name\`, \`comment\`, ` +
						'`mimetype`, `transformation`, `transformation_options`, `input_transformation`, ' +
						`\`input_transformation_options\`) SELECT ${t.db}, ${t.table}, \`column_name\`, \`comment\`, ` +
						'`mimetype`, `transformation`, `transformation_options`, `input_transformation`, ' +
						`\`input_transformation_options\` FROM ${tbl} WHERE \`db_name\` = ${f.db} AND \`table_name\` = ${f.table}`
		);
	}
	if (await hasPmaTable(dbi, server, server.table_info)) {
		const tbl = escapeQualified(server.pmadb, server.table_info);
		statements.push(
			move
				? `UPDATE ${tbl} SET \`db_name\` = ${t.db}, \`table_name\` = ${t.table} ` +
						`WHERE \`db_name\` = ${f.db} AND \`table_name\` = ${f.table}`
				: `INSERT IGNORE INTO ${tbl} (\`db_name\`, \`table_name\`, \`display_field\`) ` +
						`SELECT ${t.db}, ${t.table}, \`display_field\` FROM ${tbl} ` +
						`WHERE \`db_name\` = ${f.db} AND \`table_name\` = ${f.table}`
		);
	}
	if (await hasPmaTable(dbi, server, server.relation)) {
		const tbl = escapeQualified(server.pmadb, server.relation);
		if (move) {
			statements.push(
				`UPDATE ${tbl} SET \`foreign_db\` = ${t.db}, \`foreign_table\` = ${t.table} ` +
					`WHERE \`foreign_db\` = ${f.db} AND \`foreign_table\` = ${f.table}`,
				`UPDATE ${tbl} SET \`master_db\` = ${t.db}, \`master_table\` = ${t.table} ` +
					`WHERE \`master_db\` = ${f.db} AND \`master_table\` = ${f.table}`
			);
		} else {
			statements.push(
				`INSERT IGNORE INTO ${tbl} (\`master_db\`, \`master_table\`, \`master_field\`, \`foreign_db\`, ` +
					`\`foreign_table\`, \`foreign_field\`) SELECT ${t.db}, ${t.table}, \`master_field\`, ${t.db}, ` +
					`\`foreign_table\`, \`foreign_field\` FROM ${tbl} ` +
					`WHERE \`master_db\` = ${f.db} AND \`master_table\` = ${f.table}`,
				`INSERT IGNORE INTO ${tbl} (\`master_db\`, \`master_table\`, \`master_field\`, \`foreign_db\`, ` +
					`\`foreign_table\`, \`foreign_field\`) SELECT ${t.db}, \`master_table\`, \`master_field\`, ${t.db}, ` +
					`${t.table}, \`foreign_field\` FROM ${tbl} ` +
					`WHERE \`foreign_db\` = ${f.db} AND \`foreign_table\` = ${f.table}`
			);
		}
	}
	for (const s of statements) {
		await withControlConnection(dbi, server, (c) => c.query(s));
	}
	return statements;
}

/* -------------------------------------------------------------------------------------------
 * Orchestrators
 * ----------------------------------------------------------------------------------------- */

export interface TableOutcome extends OperationResult {
	results?: ResultSet[];
	/** Set when the table structure in the tree changed (rename, drop, copy...). */
	reload?: boolean;
}

const tableHref = (db: string, table: string, tab = 'operations') =>
	`/db/${encodeURIComponent(db)}/table/${encodeURIComponent(table)}/${tab}`;

const fail = (message: string, sql: string[] = []): TableOutcome => ({ ok: false, message, sql });

async function lowerCaseNames(dbi: DatabaseInterface): Promise<boolean> {
	return str((await rows(dbi.conn, 'SELECT @@lower_case_table_names AS v'))[0]?.v) === '1';
}

export interface TargetInput {
	targetDb: string;
	newName: string;
	adjustPrivileges: boolean;
}

/** Validate target db + name; returns the normalized name. */
async function checkTarget(
	dbi: DatabaseInterface,
	input: TargetInput,
	tr: Translator
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
	const name = (await lowerCaseNames(dbi)) ? input.newName.toLowerCase() : input.newName;
	const bad = validateTableName(name, tr);
	if (bad) return { ok: false, error: bad };
	if (isSystemSchema(input.targetDb)) {
		return { ok: false, error: tr.t('Tables cannot be created in a system database.') };
	}
	if (!(await dbi.databaseExists(input.targetDb))) {
		return { ok: false, error: tr.t('Target database {db} was not found!', { db: input.targetDb }) };
	}
	return { ok: true, name };
}

/** Table::rename: RENAME TABLE within or across databases, triggers re-created, storage + privileges carried. */
export async function moveTable(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	input: TargetInput,
	server: TableMetaServer,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<TableOutcome> {
	if (isSystemSchema(db)) return fail(tr.t('Tables of a system database cannot be modified.'));
	const t = await checkTarget(dbi, input, tr);
	if (!t.ok) return fail(t.error);
	const to = { db: input.targetDb, table: t.name };
	if (to.db === db && to.table === table) return { ok: true, message: tr.t('No change'), sql: [] };
	if ((await dbi.getTableType(to.db, to.table)) !== null) {
		return fail(tr.t('Table {table} already exists in {db}.', { table: to.table, db: to.db }));
	}
	const crossDb = to.db !== db;
	const triggers = crossDb ? await loadTriggers(dbi, db, table) : [];
	const sql: string[] = [];
	const conn = dbi.conn;
	// MySQL refuses to move a table that has triggers to another schema
	for (const tr of triggers) {
		const drop = `DROP TRIGGER IF EXISTS ${escapeQualified(db, tr.name)}`;
		sql.push(drop);
		await conn.query(drop);
	}
	const rename = buildRenameSql(db, table, to.db, to.table);
	sql.push(rename);
	try {
		await conn.query(rename);
	} catch (e) {
		// put the triggers back where they were
		await withSessionRestored(dbi, db, () =>
			runStatements(conn, [`USE ${escapeId(db)}`, ...triggers.map((tr) => tr.createSql)])
		);
		return fail(messageOf(e), sql);
	}
	if (triggers.length > 0) {
		const stmts = [
			`USE ${escapeId(to.db)}`,
			...triggers.map((tr) => retargetTrigger(tr.createSql, to.table))
		];
		const run = await withSessionRestored(dbi, db, () => runStatements(conn, stmts));
		sql.push(...run.sql.slice(1));
		if (run.error) return fail(run.error, sql);
	}
	if (input.adjustPrivileges && (await canAdjustPrivileges(dbi))) {
		const adj = await adjustTablePrivileges(conn, { db, table }, to, true);
		sql.push(...adj.sql);
		if (adj.error) return fail(adj.error, sql);
	}
	try {
		sql.push(...(await transferTableMeta(dbi, server, { db, table }, to, true)));
	} catch {
		// the configuration storage is optional
	}
	return {
		ok: true,
		message: crossDb
			? tr.t('Table {from} has been moved to {to}.', {
					from: `${db}.${table}`,
					to: `${to.db}.${to.table}`
				})
			: tr.t('Table {from} has been renamed to {to}.', {
					from: `${db}.${table}`,
					to: `${to.db}.${to.table}`
				}),
		sql,
		goto: tableHref(to.db, to.table),
		reload: true
	};
}

export interface CopyTableInput extends TargetInput {
	what: CopyWhat;
	dropTable: boolean;
	autoIncrement: boolean;
	constraints: boolean;
	switchToNew: boolean;
}

/** Table::moveCopy (copy): structure and/or data into `targetDb`.`newName`. */
export async function copyTable(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	input: CopyTableInput,
	server: TableMetaServer,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<TableOutcome> {
	const t = await checkTarget(dbi, input, tr);
	if (!t.ok) return fail(t.error);
	const to = { db: input.targetDb, table: t.name };
	if (to.db === db && to.table === table) {
		return fail(tr.t('Cannot copy a table to itself. Change the name or the database and try again.'));
	}
	const src = await loadCopySource(dbi, db, table);
	if (!src) return fail(tr.t('Table not found.'));
	const targetType = await dbi.getTableType(to.db, to.table);
	if (input.what !== 'dataonly' && targetType !== null && !input.dropTable) {
		return fail(tr.t('Table {table} already exists in {db}.', { table: to.table, db: to.db }));
	}
	if (input.what === 'dataonly' && targetType === null) {
		return fail(
			tr.t('Table {table} does not exist; copy the structure first.', {
				table: `${to.db}.${to.table}`
			})
		);
	}
	const plan = planTableCopy(src, {
		targetDb: to.db,
		targetTable: to.table,
		what: input.what,
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
	if (run.error) return fail(run.error, sql);
	if (input.adjustPrivileges && (await canAdjustPrivileges(dbi))) {
		const adj = await adjustTablePrivileges(dbi.conn, { db, table }, to, false);
		sql.push(...adj.sql);
		if (adj.error) return fail(adj.error, sql);
	}
	if (input.what !== 'dataonly') {
		try {
			sql.push(...(await transferTableMeta(dbi, server, { db, table }, to, false)));
		} catch {
			// the configuration storage is optional
		}
	}
	return {
		ok: true,
		message: tr.t('Table {from} has been copied to {to}.', {
			from: `${db}.${table}`,
			to: `${to.db}.${to.table}`
		}),
		sql,
		reload: true,
		...(input.switchToNew ? { goto: tableHref(to.db, to.table) } : {})
	};
}

export interface OptionsInput extends TableOptionsRequest {
	/** Rename to this name first ('' / same = no rename). */
	newName: string;
	adjustPrivileges: boolean;
	changeAllCollations: boolean;
}

/** Rename (optional), one ALTER TABLE with the changed options, optional column collation conversion. */
export async function applyOptions(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	input: OptionsInput,
	server: TableMetaServer,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<TableOutcome> {
	if (isSystemSchema(db)) return fail(tr.t('Tables of a system database cannot be modified.'));
	const sql: string[] = [];
	let current = table;
	let goto: string | undefined;
	let reload = false;
	if (input.newName !== '' && input.newName !== table) {
		const res = await moveTable(
			dbi,
			db,
			table,
			{ targetDb: db, newName: input.newName, adjustPrivileges: input.adjustPrivileges },
			server,
			tr
		);
		sql.push(...res.sql);
		if (!res.ok) return { ...res, sql };
		current = (await lowerCaseNames(dbi)) ? input.newName.toLowerCase() : input.newName;
		goto = res.goto;
		reload = true;
	}
	const status = await getTableStatus(dbi, db, current);
	if (!status || status.isView) return fail(tr.t('Table not found.'), sql);
	const statements = buildOptionStatements(
		current,
		status.options,
		input,
		input.changeAllCollations
	);
	const conn = dbi.conn;
	await conn.query(`USE ${escapeId(db)}`);
	const warnings: string[] = [];
	for (const stmt of statements) {
		sql.push(stmt);
		try {
			await conn.query(stmt);
		} catch (e) {
			return { ...fail(messageOf(e), sql), ...(goto ? { goto } : {}), reload };
		}
		const w = await rows(conn, 'SHOW WARNINGS').catch(() => []);
		for (const x of w) {
			// MariaDB Aria -> MyISAM reports 1478 for TRANSACTIONAL; phpMyAdmin ignores it
			if (str(x.Level) === 'Error' && Number(x.Code) !== 1478) warnings.push(str(x.Message));
		}
	}
	if (warnings.length > 0) return { ...fail(warnings.join(' '), sql), reload: true };
	if (statements.length > 0) reload = true;
	return {
		ok: true,
		message:
			statements.length === 0 && !goto
				? tr.t('No change')
				: tr.t('Table {table} has been updated.', { table: current }),
		sql,
		reload,
		...(goto ? { goto } : {})
	};
}

/** Alter table order by. */
export async function reorderTable(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	column: string,
	order: 'asc' | 'desc',
	tr: Translator = SOURCE_TRANSLATOR
): Promise<TableOutcome> {
	if (isSystemSchema(db)) return fail(tr.t('Tables of a system database cannot be modified.'));
	const cols = await dbi.getColumns(db, table);
	if (!cols.some((c) => c.field === column)) return fail(tr.t('Unknown column: {name}', { name: column }));
	const sql = buildReorderSql(table, column, order);
	const run = await withSessionRestored(dbi, db, () => runStatements(dbi.conn, [sql]));
	if (run.error) return fail(run.error, run.sql);
	return { ok: true, message: tr.t('Table {table} has been reordered by {column}.', { table, column }), sql: run.sql };
}

function fromExec(res: ExecResult, sql: string[], message: string): TableOutcome {
	if (!res.ok) return fail(res.error, sql);
	return { ok: true, message, sql, results: res.results };
}

// Plan.op is only informative for executePlan(); it needs one of the structure operations.
const plan = (statements: string[], disableFk = false): Plan => ({
	op: 'check',
	statements,
	disableFk
});

/** Analyze / Check / Checksum / Defragment / Flush / Optimize / Repair. */
export async function maintainTable(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	action: MaintenanceAction,
	isView: boolean,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<TableOutcome> {
	if (isView && action !== 'check' && action !== 'checksum') {
		return fail(tr.t('This operation is not available for views.'));
	}
	if (isSystemSchema(db) && !['check', 'checksum'].includes(action)) {
		return fail(tr.t('Tables of a system database cannot be modified.'));
	}
	const sql = [buildMaintenanceSql(action, db, table)];
	const res = await executePlan(dbi, plan(sql));
	const message =
		action === 'flush'
			? tr.t('Table {table} has been flushed.', { table })
			: action === 'defragment'
				? tr.t('Table {table} has been defragmented.', { table })
				: action === 'analyze'
					? tr.t('Analyze table: done.')
					: action === 'check'
						? tr.t('Check table: done.')
						: action === 'checksum'
							? tr.t('Checksum table: done.')
							: action === 'optimize'
								? tr.t('Optimize table: done.')
								: tr.t('Repair table: done.');
	return {
		...fromExec(res, sql, message),
		...(res.ok && ['defragment', 'flush'].includes(action) ? { reload: true } : {})
	};
}

/** TRUNCATE (optionally with foreign key checks off). */
export async function emptyTable(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	fkChecks: boolean,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<TableOutcome> {
	if (isSystemSchema(db)) return fail(tr.t('Tables of a system database cannot be modified.'));
	const sql = [buildTruncateSql(db, table)];
	const res = await executePlan(dbi, plan(sql, !fkChecks));
	return { ...fromExec(res, sql, tr.t('Table {table} has been emptied.', { table })), reload: true };
}

/** DROP TABLE / VIEW; goes to the database structure afterwards. */
export async function dropTable(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	isView: boolean,
	fkChecks: boolean,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<TableOutcome> {
	if (isSystemSchema(db)) return fail(tr.t('Tables of a system database cannot be modified.'));
	const sql = [buildDropSql(db, table, isView)];
	const res = await executePlan(dbi, plan(sql, !fkChecks));
	return {
		...fromExec(
			res,
			sql,
			isView
				? tr.t('View {table} has been dropped.', { table })
				: tr.t('Table {table} has been dropped.', { table })
		),
		goto: `/db/${encodeURIComponent(db)}/structure`,
		reload: true
	};
}

/** Partition maintenance on the selected partitions, or REMOVE PARTITIONING (`operation` null). */
export async function maintainPartitions(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	operation: PartitionOperation | null,
	names: string[],
	tr: Translator = SOURCE_TRANSLATOR
): Promise<TableOutcome> {
	if (isSystemSchema(db)) return fail(tr.t('Tables of a system database cannot be modified.'));
	const parts = await getPartitions(dbi, db, table);
	if (!parts) return fail(tr.t('The table is not partitioned.'));
	let statement: string;
	if (operation === null) {
		statement = buildRemovePartitioningSql(table);
	} else {
		if (!partitionOperationsFor(parts.method).includes(operation)) {
			return fail(
				tr.t('The operation {operation} is not available for {method} partitioning.', {
					operation,
					method: parts.method
				})
			);
		}
		const valid = names.filter((n) => parts.names.includes(n));
		if (valid.length === 0) return fail(tr.t('No partition selected.'));
		statement = buildPartitionSql(table, operation, valid);
	}
	await dbi.conn.query(`USE ${escapeId(db)}`);
	const res = await executePlan(dbi, plan([statement]));
	return {
		...fromExec(
			res,
			[statement],
			operation === null
				? tr.t('Partitioning has been removed.')
				: tr.t('Partition {operation}: done.', { operation })
		),
		reload: true
	};
}

/* -------------------------------------------------------------------------------------------
 * Form input
 * ----------------------------------------------------------------------------------------- */

const flag = z
	.union([z.string(), z.null()])
	.optional()
	.transform((v) => v !== null && v !== undefined && v !== '' && v !== '0' && v !== 'false');
const name64 = z.string().max(65);

export const reorderSchema = z.object({
	order_field: z.string().min(1).max(64),
	order_order: z.enum(['asc', 'desc']).catch('asc')
});

export const moveSchema = z.object({
	target_db: z.string().min(1).max(64),
	new_name: name64,
	adjust_privileges: flag
});

export const copySchema = z.object({
	target_db: z.string().min(1).max(64),
	new_name: name64,
	what: z.enum(['structure', 'data', 'dataonly']).catch('data'),
	drop_if_exists: flag,
	sql_auto_increment: flag,
	add_constraints: flag,
	adjust_privileges: flag,
	switch_to_new: flag
});

const identifier = /^[A-Za-z0-9_$]+$/;

/** All fields optional: only what the form submitted is considered (checkbox groups send a marker). */
export const optionsSchema = z.object({
	new_name: name64.optional(),
	adjust_privileges: flag,
	comment: z.string().max(2048).optional(),
	new_tbl_storage_engine: z.string().regex(identifier).max(64).optional().catch(undefined),
	tbl_collation: z.string().regex(identifier).max(64).optional().catch(undefined),
	change_all_collations: flag,
	new_pack_keys: z.enum(['DEFAULT', '0', '1']).optional().catch(undefined),
	new_checksum: flag,
	new_delay_key_write: flag,
	new_transactional: flag,
	new_page_checksum: flag,
	new_auto_increment: z.string().regex(/^\d*$/).max(20).optional().catch(undefined),
	new_row_format: z
		.string()
		.regex(/^[A-Za-z_]*$/)
		.max(20)
		.optional()
		.catch(undefined),
	// group markers: a checkbox is only "unchecked" when its group was rendered
	has_checksum_group: flag,
	has_aria_group: flag
});

export const maintenanceSchema = z.object({
	action: z.enum(MAINTENANCE_ACTIONS)
});

export const dangerSchema = z.object({
	fk_checks: z
		.string()
		.nullable()
		.optional()
		.transform((v) => v !== '0')
});

export const partitionSchema = z.object({
	operation: z.enum(PARTITION_OPERATIONS),
	partitions: z.array(z.string().max(64)).default([])
});
