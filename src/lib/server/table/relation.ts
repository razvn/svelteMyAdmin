/**
 * Table > Relation view (Controllers/Table/RelationController.php, templates/table/relation/*).
 * InnoDB foreign keys through information_schema + ALTER TABLE, and phpMyAdmin's internal relations
 * (`pma__relation`) and display column (`pma__table_info`) when the configuration storage exists.
 */
import { z } from 'zod';
import type { ServerConfig } from '../config/schema';
import { sqlErrorMessage } from '../database/common';
import { withControlConnection, type StorageServer } from '../database/operations';
import type { DatabaseInterface } from '../db/dbi';
import { escapeQualified } from '../db/escape';
import {
	FK_ACTIONS,
	buildAddForeignKey,
	buildDropForeignKey,
	columnsAreIndexed,
	groupForeignKeys,
	supportsForeignKeys,
	validateFkDef,
	type FkDef,
	type FkRow
} from '#lib/sql/foreign-key.ts';
import { loadColumns, loadIndexes, getCaps, type ActionResult } from './structure';
import { N_, SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

async function query(dbi: DatabaseInterface, sql: string, params: unknown[] = []): Promise<Row[]> {
	const [rows] = await dbi.conn.query(sql, params);
	return rows as Row[];
}

export async function getEngine(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<string | null> {
	const [r] = await query(
		dbi,
		'SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
		[db, table]
	);
	return r?.engine === null || r?.engine === undefined ? null : String(r.engine);
}

export async function loadForeignKeys(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<FkDef[]> {
	const rows = await query(
		dbi,
		'SELECT k.CONSTRAINT_NAME AS cname, k.COLUMN_NAME AS col, k.ORDINAL_POSITION AS ord, ' +
			'k.REFERENCED_TABLE_SCHEMA AS rdb, k.REFERENCED_TABLE_NAME AS rtable, ' +
			'k.REFERENCED_COLUMN_NAME AS rcol, r.DELETE_RULE AS del, r.UPDATE_RULE AS upd ' +
			'FROM information_schema.KEY_COLUMN_USAGE k ' +
			'JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA ' +
			'AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME ' +
			'WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ' +
			'ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
		[db, table]
	);
	const fkRows: FkRow[] = rows.map((r) => ({
		constraintName: str(r.cname),
		columnName: str(r.col),
		ordinal: Number(r.ord),
		refDb: str(r.rdb),
		refTable: str(r.rtable),
		refColumn: str(r.rcol),
		deleteRule: str(r.del),
		updateRule: str(r.upd)
	}));
	return groupForeignKeys(fkRows);
}

/** Tables (base tables and views excluded) of a database, for the "referenced table" dropdown. */
export async function listTableNames(dbi: DatabaseInterface, db: string): Promise<string[]> {
	const rows = await query(
		dbi,
		'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ' +
			"AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
		[db]
	);
	return rows.map((r) => str(r.name));
}

export async function listColumnNames(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<string[]> {
	const rows = await query(
		dbi,
		'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ' +
			'AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
		[db, table]
	);
	return rows.map((r) => str(r.name));
}

const ident = z.string().min(1).max(64);
export const fkDefSchema = z.object({
	name: z.string().max(64),
	columns: z.array(z.string().max(64)).min(1).max(16),
	refDb: z.string().max(64),
	refTable: z.string().max(64),
	refColumns: z.array(z.string().max(64)).min(1).max(16),
	onDelete: z.enum(FK_ACTIONS as unknown as [string, ...string[]]),
	onUpdate: z.enum(FK_ACTIONS as unknown as [string, ...string[]])
});
export const saveFkSchema = z.object({ original: ident.nullable(), def: fkDefSchema });
export const dropFkSchema = z.object({ name: ident });

interface Ctx {
	dbi: DatabaseInterface;
	db: string;
	table: string;
	tr?: Translator;
}

const fail = (error: string, sql: string[] = []): ActionResult => ({ ok: false, error, sql });

/** Add a foreign key, or replace `original` (drop + add; the original is restored on failure). */
export async function saveForeignKey(
	{ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx,
	raw: unknown
): Promise<ActionResult> {
	const parsed = saveFkSchema.safeParse(raw);
	if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? tr.t('Invalid input.'));
	const def = parsed.data.def as FkDef;
	const bad = validateFkDef(def);
	if (bad) return fail(tr.t(bad));

	if (!supportsForeignKeys(await getEngine(dbi, db, table))) {
		return fail(tr.t('Foreign keys need a table that uses the InnoDB storage engine.'));
	}
	const caps = await getCaps(dbi);
	const own = (await loadColumns(dbi, db, table, caps)).map((c) => c.def.name);
	const unknown = def.columns.find((c) => !own.includes(c));
	if (unknown) return fail(tr.t('Unknown column {name}.', { name: unknown }));

	const refTables = await listTableNames(dbi, def.refDb);
	if (!refTables.includes(def.refTable)) {
		return fail(
			tr.t('The referenced table {table} does not exist.', {
				table: `${def.refDb}.${def.refTable}`
			})
		);
	}
	const refCols = await listColumnNames(dbi, def.refDb, def.refTable);
	const unknownRef = def.refColumns.find((c) => !refCols.includes(c));
	if (unknownRef) return fail(tr.t('Unknown referenced column {name}.', { name: unknownRef }));
	const refIndexes = await loadIndexes(dbi, def.refDb, def.refTable);
	if (!columnsAreIndexed(def.refColumns, refIndexes)) {
		return fail(
			tr.t(
				'The referenced column(s) {columns} must be indexed (a PRIMARY, UNIQUE or INDEX key that starts with them).',
				{ columns: def.refColumns.join(', ') }
			)
		);
	}

	const existing = await loadForeignKeys(dbi, db, table);
	let original: FkDef | undefined;
	if (parsed.data.original !== null) {
		original = existing.find((f) => f.name === parsed.data.original);
		if (!original) return fail(tr.t('Unknown foreign key {name}.', { name: parsed.data.original }));
	}
	if (
		def.name !== '' &&
		existing.some((f) => f.name.toLowerCase() === def.name.toLowerCase() && f !== original)
	) {
		return fail(tr.t('A foreign key named {name} already exists.', { name: def.name }));
	}

	const statements: string[] = [];
	if (original) statements.push(buildDropForeignKey(db, table, original.name));
	statements.push(buildAddForeignKey(db, table, def));
	const done: string[] = [];
	try {
		for (const s of statements) {
			await dbi.conn.query(s);
			done.push(s);
		}
		return { ok: true, sql: statements };
	} catch (e) {
		let message = sqlErrorMessage(e, N_('The statement failed.'));
		if (original && done.length > 0) {
			try {
				await dbi.conn.query(buildAddForeignKey(db, table, original));
				message += ' ' + tr.t('The original foreign key was restored.');
			} catch {
				message +=
					' ' +
					tr.t('The original foreign key could not be restored: {sql}', {
						sql: buildAddForeignKey(db, table, original)
					});
			}
		}
		return fail(message, statements);
	}
}

export async function dropForeignKey(
	{ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx,
	raw: unknown
): Promise<ActionResult> {
	const parsed = dropFkSchema.safeParse(raw);
	if (!parsed.success) return fail(tr.t('Invalid input.'));
	const existing = await loadForeignKeys(dbi, db, table);
	if (!existing.some((f) => f.name === parsed.data.name)) {
		return fail(tr.t('Unknown foreign key {name}.', { name: parsed.data.name }));
	}
	const sql = buildDropForeignKey(db, table, parsed.data.name);
	try {
		await dbi.conn.query(sql);
		return { ok: true, sql: [sql] };
	} catch (e) {
		return fail(sqlErrorMessage(e, N_('The statement failed.')), [sql]);
	}
}

// --- configuration storage: internal relations and display column ---

export type RelationServer = StorageServer & Pick<ServerConfig, 'table_info'>;

export interface InternalRelation {
	column: string;
	refDb: string;
	refTable: string;
	refColumn: string;
}

export interface StorageFeatures {
	/** `pma__relation` is configured and reachable. */
	relation: boolean;
	/** `pma__table_info` is configured and reachable. */
	tableInfo: boolean;
}

async function tableReachable(
	dbi: DatabaseInterface,
	server: RelationServer,
	table: string
): Promise<boolean> {
	if (!server.pmadb || !table) return false;
	try {
		await withControlConnection(dbi, server, (c) =>
			c.query(`SELECT 1 FROM ${escapeQualified(server.pmadb, table)} LIMIT 1`)
		);
		return true;
	} catch {
		return false;
	}
}

export async function detectStorage(
	dbi: DatabaseInterface,
	server: RelationServer
): Promise<StorageFeatures> {
	const [relation, tableInfo] = await Promise.all([
		tableReachable(dbi, server, server.relation),
		tableReachable(dbi, server, server.table_info)
	]);
	return { relation, tableInfo };
}

export async function loadInternalRelations(
	dbi: DatabaseInterface,
	server: RelationServer,
	db: string,
	table: string
): Promise<InternalRelation[]> {
	const rows = await withControlConnection(dbi, server, async (c) => {
		const [r] = await c.query(
			'SELECT master_field, foreign_db, foreign_table, foreign_field FROM ' +
				`${escapeQualified(server.pmadb, server.relation)} WHERE master_db = ? AND master_table = ? ` +
				'ORDER BY master_field',
			[db, table]
		);
		return r as Row[];
	});
	return rows.map((r) => ({
		column: str(r.master_field),
		refDb: str(r.foreign_db),
		refTable: str(r.foreign_table),
		refColumn: str(r.foreign_field)
	}));
}

export async function loadDisplayField(
	dbi: DatabaseInterface,
	server: RelationServer,
	db: string,
	table: string
): Promise<string> {
	const rows = await withControlConnection(dbi, server, async (c) => {
		const [r] = await c.query(
			`SELECT display_field FROM ${escapeQualified(server.pmadb, server.table_info)} ` +
				'WHERE db_name = ? AND table_name = ?',
			[db, table]
		);
		return r as Row[];
	});
	return str(rows[0]?.display_field);
}

const internalSchema = z.object({
	column: ident,
	/** All empty = remove the relation of the column. */
	refDb: z.string().max(64),
	refTable: z.string().max(64),
	refColumn: z.string().max(64)
});

/** Set (or, with an empty target, remove) the internal relation of one column. */
export async function saveInternalRelation(
	{ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx,
	server: RelationServer,
	raw: unknown
): Promise<ActionResult> {
	const parsed = internalSchema.safeParse(raw);
	if (!parsed.success) return fail(tr.t('Invalid input.'));
	const rel = parsed.data;
	if (!(await tableReachable(dbi, server, server.relation))) {
		return fail(tr.t('The relation table of the configuration storage is not available.'));
	}
	const caps = await getCaps(dbi);
	const own = (await loadColumns(dbi, db, table, caps)).map((c) => c.def.name);
	if (!own.includes(rel.column)) return fail(tr.t('Unknown column {name}.', { name: rel.column }));
	const target = `${escapeQualified(server.pmadb, server.relation)}`;
	const remove = rel.refDb === '' && rel.refTable === '' && rel.refColumn === '';
	const statements: { sql: string; params: unknown[] }[] = [
		{
			sql: `DELETE FROM ${target} WHERE master_db = ? AND master_table = ? AND master_field = ?`,
			params: [db, table, rel.column]
		}
	];
	if (!remove) {
		if (!rel.refDb || !rel.refTable || !rel.refColumn)
			return fail(tr.t('Choose the referenced column.'));
		const refCols = await listColumnNames(dbi, rel.refDb, rel.refTable);
		if (!refCols.includes(rel.refColumn))
			return fail(tr.t('The referenced column does not exist.'));
		statements.push({
			sql:
				`INSERT INTO ${target} (master_db, master_table, master_field, foreign_db, foreign_table, ` +
				'foreign_field) VALUES (?, ?, ?, ?, ?, ?)',
			params: [db, table, rel.column, rel.refDb, rel.refTable, rel.refColumn]
		});
	}
	try {
		await withControlConnection(dbi, server, async (c) => {
			for (const s of statements) await c.query(s.sql, s.params);
		});
		return { ok: true, sql: statements.map((s) => s.sql) };
	} catch (e) {
		return fail(sqlErrorMessage(e, N_('The statement failed.')));
	}
}

const displaySchema = z.object({ column: z.string().max(64) });

/** Choose the column to display (empty = remove). */
export async function saveDisplayField(
	{ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx,
	server: RelationServer,
	raw: unknown
): Promise<ActionResult> {
	const parsed = displaySchema.safeParse(raw);
	if (!parsed.success) return fail(tr.t('Invalid input.'));
	if (!(await tableReachable(dbi, server, server.table_info))) {
		return fail(tr.t('The table information table of the configuration storage is not available.'));
	}
	const column = parsed.data.column;
	if (column !== '') {
		const caps = await getCaps(dbi);
		const own = (await loadColumns(dbi, db, table, caps)).map((c) => c.def.name);
		if (!own.includes(column)) return fail(tr.t('Unknown column {name}.', { name: column }));
	}
	const target = escapeQualified(server.pmadb, server.table_info);
	try {
		await withControlConnection(dbi, server, async (c) => {
			if (column === '') {
				await c.query(`DELETE FROM ${target} WHERE db_name = ? AND table_name = ?`, [db, table]);
			} else {
				await c.query(
					`REPLACE INTO ${target} (db_name, table_name, display_field) VALUES (?, ?, ?)`,
					[db, table, column]
				);
			}
		});
		return { ok: true, sql: [] };
	} catch (e) {
		return fail(sqlErrorMessage(e, N_('The statement failed.')));
	}
}
