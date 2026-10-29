/**
 * Table > Structure (Controllers/Table/StructureController.php, Structure/*, AddFieldController,
 * DropColumnController, IndexesController). Loads columns / indexes / statistics / partitions and
 * runs the ALTER TABLE actions. Every statement is rebuilt here from validated, structured input
 * with the shared pure builders; the browser's SQL is only a preview.
 */
import { z } from 'zod';
import type { DatabaseInterface } from '../db/dbi';
import { escapeQualified } from '../db/escape';
import { sqlErrorMessage } from '../database/common';
import { columnSchema, normalizeColumns } from '../database/create-table';
import {
	buildAddColumns,
	buildChangeColumns,
	buildDropColumns,
	buildMoveColumns,
	isPermutation
} from '#lib/sql/alter-table.ts';
import { columnFromInfo } from '#lib/sql/column-from-info.ts';
import { namedColumns, type ColumnDef, type ServerCaps } from '#lib/sql/column-definition.ts';
import {
	INDEX_KINDS,
	INDEX_TYPES,
	buildAddKey,
	buildDropIndex,
	buildRenameIndex,
	buildSaveIndex,
	groupIndexes,
	parseKeyOptions,
	supportsRenameIndex,
	validateIndexDef,
	type IndexDef,
	type IndexKind,
	type IndexRow,
	type ParsedIndex
} from '#lib/sql/index-definition.ts';
import { N_, SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

async function query(dbi: DatabaseInterface, sql: string, params: unknown[] = []): Promise<Row[]> {
	const [rows] = await dbi.conn.query(sql, params);
	return rows as Row[];
}

export async function getCaps(dbi: DatabaseInterface): Promise<ServerCaps> {
	const info = await dbi.getServerInfo();
	return { serverType: info.serverType, version: info.versionInt };
}

// --- loaders ---

export interface StructureColumn {
	def: ColumnDef;
	/** COLUMN_TYPE as the server reports it (`int unsigned`). */
	columnType: string;
	extra: string;
	/** 1-based position. */
	position: number;
}

/** Columns in table order, rebuilt as editable definitions (ids are the 0-based positions). */
export async function loadColumns(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	caps: ServerCaps
): Promise<StructureColumn[]> {
	const rows = await query(
		dbi,
		'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS column_type, IS_NULLABLE AS nullable, ' +
			'COLUMN_DEFAULT AS column_default, EXTRA AS extra, COLLATION_NAME AS collation, ' +
			'COLUMN_COMMENT AS comment, GENERATION_EXPRESSION AS generation_expression ' +
			'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ' +
			'ORDER BY ORDINAL_POSITION',
		[db, table]
	);
	return rows.map((r, i) => ({
		def: columnFromInfo(
			{
				name: str(r.name),
				columnType: str(r.column_type),
				nullable: str(r.nullable) === 'YES',
				columnDefault: strOrNull(r.column_default),
				extra: str(r.extra),
				collation: strOrNull(r.collation),
				comment: str(r.comment),
				generationExpression: strOrNull(r.generation_expression)
			},
			caps,
			i
		),
		columnType: str(r.column_type),
		extra: str(r.extra),
		position: i + 1
	}));
}

export async function loadIndexes(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<ParsedIndex[]> {
	const rows = await query(dbi, `SHOW INDEX FROM ${escapeQualified(db, table)}`);
	const parsed: IndexRow[] = rows.map((r) => ({
		keyName: str(r.Key_name),
		nonUnique: Number(r.Non_unique) === 1,
		seqInIndex: Number(r.Seq_in_index),
		columnName: strOrNull(r.Column_name),
		collation: strOrNull(r.Collation),
		cardinality: numOrNull(r.Cardinality),
		subPart: numOrNull(r.Sub_part),
		packed: strOrNull(r.Packed),
		nullable: str(r.Null) === 'YES',
		indexType: str(r.Index_type),
		comment: str(r.Comment),
		indexComment: str(r.Index_comment),
		expression: strOrNull(r.Expression),
		// MySQL 8: Visible; MariaDB 10.6+: Ignored
		visible: r.Visible !== undefined ? str(r.Visible) === 'YES' : str(r.Ignored) !== 'YES'
	}));
	let options = {};
	if (parsed.length > 0) {
		try {
			const [create] = await query(dbi, `SHOW CREATE TABLE ${escapeQualified(db, table)}`);
			options = parseKeyOptions(str(create?.['Create Table']));
		} catch {
			// options are a nicety
		}
	}
	return groupIndexes(parsed, options);
}

export interface TableStats {
	engine: string | null;
	rowFormat: string | null;
	createOptions: string;
	collation: string | null;
	comment: string;
	rows: number | null;
	avgRowLength: number;
	dataLength: number;
	indexLength: number;
	dataFree: number | null;
	autoIncrement: number | null;
	createTime: string | null;
	updateTime: string | null;
	checkTime: string | null;
}

export async function loadStats(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<TableStats | null> {
	const [r] = await query(
		dbi,
		'SELECT ENGINE AS engine, ROW_FORMAT AS row_format, CREATE_OPTIONS AS create_options, ' +
			'TABLE_COLLATION AS collation, TABLE_COMMENT AS comment, TABLE_ROWS AS table_rows, ' +
			'AVG_ROW_LENGTH AS avg_row_length, DATA_LENGTH AS data_length, INDEX_LENGTH AS index_length, ' +
			'DATA_FREE AS data_free, AUTO_INCREMENT AS auto_increment, CREATE_TIME AS create_time, ' +
			'UPDATE_TIME AS update_time, CHECK_TIME AS check_time ' +
			'FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
		[db, table]
	);
	if (!r) return null;
	const date = (v: unknown): string | null =>
		v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v);
	return {
		engine: strOrNull(r.engine),
		rowFormat: strOrNull(r.row_format),
		createOptions: str(r.create_options),
		collation: strOrNull(r.collation),
		comment: str(r.comment),
		rows: numOrNull(r.table_rows),
		avgRowLength: Number(r.avg_row_length ?? 0),
		dataLength: Number(r.data_length ?? 0),
		indexLength: Number(r.index_length ?? 0),
		dataFree: numOrNull(r.data_free),
		autoIncrement: numOrNull(r.auto_increment),
		createTime: date(r.create_time),
		updateTime: date(r.update_time),
		checkTime: date(r.check_time)
	};
}

export interface PartitionInfo {
	name: string;
	ordinal: number;
	description: string;
	rows: number;
	dataLength: number;
	indexLength: number;
	comment: string;
	subPartitions: {
		name: string;
		ordinal: number;
		rows: number;
		dataLength: number;
		indexLength: number;
		comment: string;
	}[];
}

export interface PartitionData {
	method: string;
	expression: string;
	subMethod: string;
	subExpression: string;
	partitions: PartitionInfo[];
}

/** Partitions of the table, or null when it is not partitioned (read-only, like phpMyAdmin's list). */
export async function loadPartitions(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<PartitionData | null> {
	let rows: Row[];
	try {
		rows = await query(
			dbi,
			'SELECT PARTITION_NAME AS pname, SUBPARTITION_NAME AS sname, ' +
				'PARTITION_ORDINAL_POSITION AS pord, SUBPARTITION_ORDINAL_POSITION AS sord, ' +
				'PARTITION_METHOD AS pmethod, SUBPARTITION_METHOD AS smethod, ' +
				'PARTITION_EXPRESSION AS pexpr, SUBPARTITION_EXPRESSION AS sexpr, ' +
				'PARTITION_DESCRIPTION AS pdesc, TABLE_ROWS AS trows, DATA_LENGTH AS dlen, ' +
				'INDEX_LENGTH AS ilen, PARTITION_COMMENT AS pcomment ' +
				'FROM information_schema.PARTITIONS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ' +
				'ORDER BY PARTITION_ORDINAL_POSITION, SUBPARTITION_ORDINAL_POSITION',
			[db, table]
		);
	} catch {
		return null;
	}
	const named = rows.filter((r) => r.pname !== null && r.pname !== undefined);
	if (named.length === 0) return null;
	const data: PartitionData = {
		method: str(named[0].pmethod),
		expression: str(named[0].pexpr).trim(),
		subMethod: str(named[0].smethod),
		subExpression: str(named[0].sexpr).trim(),
		partitions: []
	};
	for (const r of named) {
		const detail = {
			rows: Number(r.trows ?? 0),
			dataLength: Number(r.dlen ?? 0),
			indexLength: Number(r.ilen ?? 0),
			comment: str(r.pcomment)
		};
		if (r.sname !== null && r.sname !== undefined) {
			let p = data.partitions.find((x) => x.name === str(r.pname));
			if (!p) {
				p = {
					name: str(r.pname),
					ordinal: Number(r.pord),
					description: str(r.pdesc),
					rows: 0,
					dataLength: 0,
					indexLength: 0,
					comment: '',
					subPartitions: []
				};
				data.partitions.push(p);
			}
			p.subPartitions.push({ name: str(r.sname), ordinal: Number(r.sord), ...detail });
			p.rows += detail.rows;
			p.dataLength += detail.dataLength;
			p.indexLength += detail.indexLength;
		} else {
			data.partitions.push({
				name: str(r.pname),
				ordinal: Number(r.pord),
				description: str(r.pdesc),
				...detail,
				subPartitions: []
			});
		}
	}
	return data;
}

// --- actions ---

export type ActionResult =
	{ ok: true; sql: string[] } | { ok: false; error: string; sql: string[] };

const fail = (error: string, sql: string[] = []): ActionResult => ({ ok: false, error, sql });

async function run(
	dbi: DatabaseInterface,
	db: string,
	statements: string[]
): Promise<ActionResult> {
	try {
		for (const s of statements) await dbi.conn.query(s);
		return { ok: true, sql: statements };
	} catch (e) {
		return fail(sqlErrorMessage(e, N_('The statement failed.')), statements);
	}
}

const name = z.string().min(1).max(64);
const names = z.array(name).min(1).max(4096);

const indexDefSchema = z.object({
	name: z.string().max(64),
	kind: z.enum(INDEX_KINDS as unknown as [string, ...string[]]),
	columns: z.array(z.object({ name: z.string().max(64), size: z.string().max(10) })).max(64),
	keyBlockSize: z.string().max(10),
	indexType: z.enum(INDEX_TYPES as unknown as [string, ...string[]]),
	parser: z.string().max(64),
	comment: z.string().max(1024),
	invisible: z.boolean()
});

const placementSchema = z.discriminatedUnion('where', [
	z.object({ where: z.literal('end') }),
	z.object({ where: z.literal('first') }),
	z.object({ where: z.literal('after'), after: name })
]);

export const schemas = {
	dropColumns: z.object({ columns: names }),
	addKey: z.object({
		kind: z.enum(INDEX_KINDS as unknown as [string, ...string[]]),
		columns: names,
		replacePrimary: z.boolean().default(false)
	}),
	moveColumns: z.object({ order: names }),
	saveIndex: z.object({ original: name.nullable(), def: indexDefSchema }),
	dropIndex: z.object({ name }),
	renameIndex: z.object({ from: name, to: name }),
	addColumns: z.object({
		columns: z.array(columnSchema).min(1).max(4096),
		placement: placementSchema
	}),
	changeColumns: z.object({
		changes: z
			.array(z.object({ oldName: name, col: columnSchema }))
			.min(1)
			.max(4096)
	})
};

interface Ctx {
	dbi: DatabaseInterface;
	db: string;
	table: string;
	tr?: Translator;
}

function parse<S extends z.ZodType>(
	schema: S,
	raw: unknown,
	tr: Translator
): z.infer<S> | string {
	const res = schema.safeParse(raw);
	return res.success ? res.data : (res.error.issues[0]?.message ?? tr.t('Invalid input.'));
}

export async function dropColumns({ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx, raw: unknown): Promise<ActionResult> {
	const input = parse(schemas.dropColumns, raw, tr);
	if (typeof input === 'string') return fail(input);
	const caps = await getCaps(dbi);
	const existing = (await loadColumns(dbi, db, table, caps)).map((c) => c.def.name);
	const unknown = input.columns.find((c) => !existing.includes(c));
	if (unknown) return fail(tr.t('Unknown column {name}.', { name: unknown }));
	if (new Set(input.columns).size >= existing.length) {
		return fail(tr.t('You cannot remove all the columns of a table (drop the table instead).'));
	}
	return run(dbi, db, [buildDropColumns(db, table, input.columns)]);
}

export async function addKey({ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx, raw: unknown): Promise<ActionResult> {
	const input = parse(schemas.addKey, raw, tr);
	if (typeof input === 'string') return fail(input);
	const caps = await getCaps(dbi);
	const existing = (await loadColumns(dbi, db, table, caps)).map((c) => c.def.name);
	const unknown = input.columns.find((c) => !existing.includes(c));
	if (unknown) return fail(tr.t('Unknown column {name}.', { name: unknown }));
	if (new Set(input.columns).size !== input.columns.length) return fail(tr.t('A column is used twice.'));
	const indexes = await loadIndexes(dbi, db, table);
	const hasPrimary = indexes.some((i) => i.kind === 'PRIMARY');
	const kind = input.kind as IndexKind;
	if (kind === 'PRIMARY' && hasPrimary && !input.replacePrimary) {
		return fail(tr.t('The table already has a primary key.'));
	}
	return run(dbi, db, [
		buildAddKey(db, table, kind, input.columns, { replacePrimary: input.replacePrimary })
	]);
}

export async function moveColumns({ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx, raw: unknown): Promise<ActionResult> {
	const input = parse(schemas.moveColumns, raw, tr);
	if (typeof input === 'string') return fail(input);
	const caps = await getCaps(dbi);
	const current = (await loadColumns(dbi, db, table, caps)).map((c) => c.def);
	if (
		!isPermutation(
			current.map((c) => c.name),
			input.order
		)
	) {
		return fail(tr.t('The new order must list every column of the table exactly once.'));
	}
	const sql = buildMoveColumns(db, table, current, input.order, caps);
	if (sql === '') return fail(tr.t('The columns are already in that order.'));
	return run(dbi, db, [sql]);
}

export async function saveIndex({ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx, raw: unknown): Promise<ActionResult> {
	const input = parse(schemas.saveIndex, raw, tr);
	if (typeof input === 'string') return fail(input);
	const caps = await getCaps(dbi);
	const def = input.def as IndexDef;
	const existing = (await loadColumns(dbi, db, table, caps)).map((c) => c.def.name);
	const bad = validateIndexDef(def, existing, tr);
	if (bad) return fail(bad);
	const indexes = await loadIndexes(dbi, db, table);
	let original: { name: string; kind: IndexKind } | null = null;
	if (input.original !== null) {
		const found = indexes.find((i) => i.name === input.original);
		if (!found) return fail(tr.t('Unknown index {name}.', { name: input.original }));
		original = { name: found.name, kind: found.kind };
	}
	if (
		def.kind === 'PRIMARY' &&
		indexes.some((i) => i.kind === 'PRIMARY' && i.name !== original?.name)
	) {
		return fail(tr.t('The table already has a primary key.'));
	}
	if (
		def.name !== '' &&
		def.kind !== 'PRIMARY' &&
		indexes.some(
			(i) => i.name.toLowerCase() === def.name.toLowerCase() && i.name !== original?.name
		)
	) {
		return fail(tr.t('An index named {name} already exists.', { name: def.name }));
	}
	return run(dbi, db, [buildSaveIndex(db, table, def, original, caps)]);
}

export async function dropIndex({ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx, raw: unknown): Promise<ActionResult> {
	const input = parse(schemas.dropIndex, raw, tr);
	if (typeof input === 'string') return fail(input);
	const found = (await loadIndexes(dbi, db, table)).find((i) => i.name === input.name);
	if (!found) return fail(tr.t('Unknown index {name}.', { name: input.name }));
	return run(dbi, db, [buildDropIndex(db, table, found.name, found.kind)]);
}

export async function renameIndex({ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx, raw: unknown): Promise<ActionResult> {
	const input = parse(schemas.renameIndex, raw, tr);
	if (typeof input === 'string') return fail(input);
	const caps = await getCaps(dbi);
	if (!supportsRenameIndex(caps)) return fail(tr.t('This server cannot rename indexes.'));
	const indexes = await loadIndexes(dbi, db, table);
	const found = indexes.find((i) => i.name === input.from);
	if (!found) return fail(tr.t('Unknown index {name}.', { name: input.from }));
	if (found.kind === 'PRIMARY') return fail(tr.t('The PRIMARY KEY cannot be renamed.'));
	if (input.to.toUpperCase() === 'PRIMARY') return fail(tr.t('PRIMARY is a reserved index name.'));
	if (indexes.some((i) => i.name.toLowerCase() === input.to.toLowerCase() && i !== found)) {
		return fail(tr.t('An index named {name} already exists.', { name: input.to }));
	}
	return run(dbi, db, [buildRenameIndex(db, table, input.from, input.to)]);
}

export async function addColumns({ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx, raw: unknown): Promise<ActionResult> {
	const input = parse(schemas.addColumns, raw, tr);
	if (typeof input === 'string') return fail(input);
	const caps = await getCaps(dbi);
	const checked = normalizeColumns(input.columns, caps);
	if (!checked.ok) return fail(checked.error);
	const columns = namedColumns(checked.columns);
	if (columns.length === 0) return fail(tr.t('Give a name to at least one column.'));
	const existing = (await loadColumns(dbi, db, table, caps)).map((c) => c.def.name);
	const lower = new Set(existing.map((n) => n.toLowerCase()));
	for (const c of columns) {
		if (lower.has(c.name.toLowerCase())) return fail(tr.t('Column {name} already exists.', { name: c.name }));
		lower.add(c.name.toLowerCase());
	}
	if (input.placement.where === 'after' && !existing.includes(input.placement.after)) {
		return fail(tr.t('Unknown column {name}.', { name: input.placement.after }));
	}
	const hasPrimary = (await loadIndexes(dbi, db, table)).some((i) => i.kind === 'PRIMARY');
	if (hasPrimary && columns.some((c) => c.index === 'PRIMARY')) {
		return fail(tr.t('The table already has a primary key.'));
	}
	return run(dbi, db, [
		buildAddColumns(db, table, columns, caps, input.placement, { tableHasPrimary: hasPrimary })
	]);
}

export async function changeColumns({ dbi, db, table, tr = SOURCE_TRANSLATOR }: Ctx, raw: unknown): Promise<ActionResult> {
	const input = parse(schemas.changeColumns, raw, tr);
	if (typeof input === 'string') return fail(input);
	const caps = await getCaps(dbi);
	const checked = normalizeColumns(
		input.changes.map((c) => c.col),
		caps
	);
	if (!checked.ok) return fail(checked.error);
	const existing = (await loadColumns(dbi, db, table, caps)).map((c) => c.def.name);
	const changes = input.changes.map((c, i) => ({ oldName: c.oldName, col: checked.columns[i] }));
	for (const c of changes) {
		if (!existing.includes(c.oldName)) return fail(tr.t('Unknown column {name}.', { name: c.oldName }));
		if (c.col.name.trim() === '') return fail(tr.t('A column name is empty.'));
	}
	// final names must be unique
	const finals = existing.map((n) => changes.find((c) => c.oldName === n)?.col.name ?? n);
	if (new Set(finals.map((n) => n.toLowerCase())).size !== finals.length) {
		return fail(tr.t('Two columns would get the same name.'));
	}
	return run(dbi, db, [buildChangeColumns(db, table, changes, caps)]);
}
