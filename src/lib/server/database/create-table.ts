/**
 * Create table (Controllers/Table/CreateController.php, CreateAddField.php).
 * The browser submits the structured definition; the SQL is always rebuilt here with the shared
 * `buildCreateTable` (never trusted from the client).
 */
import { z } from 'zod';
import { N_, SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';
import type { DatabaseInterface } from '../db/dbi';
import { listEngines } from '../admin/engines';
import {
	DEFAULT_TYPES,
	INDEX_CHOICES,
	buildCreateTable,
	getAllTypes,
	getAttributes,
	getVirtualities,
	namedColumns,
	type ColumnDef,
	type DefaultType,
	type IndexChoice,
	type ServerCaps
} from '#lib/sql/column-definition.ts';

/** MySQL maximum number of columns per table. */
export const MAX_FIELDS = 4096;
export const DEFAULT_NUM_FIELDS = 4;

/** `num_fields` query parameter (CreateAddField::getNumberOfFieldsFromRequest). */
export function parseNumFields(raw: string | null): number {
	const n = Number.parseInt(raw ?? '', 10);
	return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_FIELDS) : DEFAULT_NUM_FIELDS;
}

export interface EngineOption {
	name: string;
	comment: string;
	isDefault: boolean;
}

export interface CreateTableContext {
	caps: ServerCaps;
	collations: { name: string; charset: string }[];
	engines: EngineOption[];
	defaultEngine: string;
}

/** What the shared column editor needs: server capabilities and collations. */
export async function getColumnEditorContext(
	dbi: DatabaseInterface
): Promise<Pick<CreateTableContext, 'caps' | 'collations'>> {
	const [info, collations] = await Promise.all([dbi.getServerInfo(), dbi.listCollations()]);
	return {
		caps: { serverType: info.serverType, version: info.versionInt },
		collations: collations.map((c) => ({ name: c.name, charset: c.charset }))
	};
}

export async function getCreateTableContext(dbi: DatabaseInterface): Promise<CreateTableContext> {
	const info = await dbi.getServerInfo();
	const [collations, engines] = await Promise.all([dbi.listCollations(), listEngines(dbi.conn)]);
	const usable: EngineOption[] = engines
		.filter((e) => e.support === 'YES' || e.support === 'DEFAULT')
		.map((e) => ({ name: e.name, comment: e.comment, isDefault: e.support === 'DEFAULT' }));
	return {
		caps: { serverType: info.serverType, version: info.versionInt },
		collations: collations.map((c) => ({ name: c.name, charset: c.charset })),
		engines: usable,
		defaultEngine: (usable.find((e) => e.isDefault) ?? usable[0])?.name ?? ''
	};
}

const identifier = /^[A-Za-z0-9_]+$/;

export const columnSchema = z.object({
	id: z.number().optional().default(0),
	name: z.string().max(64),
	type: z.string().min(1),
	length: z.string().max(4000),
	defaultType: z.enum(DEFAULT_TYPES as [string, ...string[]]),
	defaultValue: z.string().max(4000),
	collation: z.string().regex(identifier).or(z.literal('')),
	attribute: z.string().max(64),
	null: z.boolean(),
	index: z.enum(INDEX_CHOICES as unknown as [string, ...string[]]),
	autoIncrement: z.boolean(),
	comment: z.string().max(1024),
	virtuality: z.string().max(16),
	expression: z.string().max(4000)
});

export const createTableSchema = z.object({
	name: z.string().trim().min(1, N_('The table name is empty!')).max(64, N_('Name is too long.')),
	comment: z.string().max(2048).default(''),
	collation: z.string().regex(identifier).or(z.literal('')).default(''),
	engine: z.string().regex(identifier).or(z.literal('')).default(''),
	columns: z.array(columnSchema).max(MAX_FIELDS)
});

export type ColumnInput = z.infer<typeof columnSchema>;

/** Upper-case the types and check type / attribute / virtuality against the server's catalog. */
export function normalizeColumns(
	input: ColumnInput[],
	caps: ServerCaps,
	tr: Translator = SOURCE_TRANSLATOR
): { ok: true; columns: ColumnDef[] } | { ok: false; error: string } {
	const types = new Set(getAllTypes(caps));
	const attributes = new Set(['', ...getAttributes(caps)]);
	const virtualities = new Set(['', ...getVirtualities(caps)]);
	const columns: ColumnDef[] = input.map((c) => ({
		...c,
		type: c.type.toUpperCase(),
		defaultType: c.defaultType as DefaultType,
		index: c.index as IndexChoice
	}));
	for (const c of namedColumns(columns)) {
		if (!types.has(c.type)) return { ok: false, error: tr.t('Unsupported column type {type}.', { type: c.type }) };
		if (!attributes.has(c.attribute)) {
			return { ok: false, error: tr.t('Unsupported attribute {attribute}.', { attribute: c.attribute }) };
		}
		if (!virtualities.has(c.virtuality)) {
			return { ok: false, error: tr.t('Unsupported virtuality {virtuality}.', { virtuality: c.virtuality }) };
		}
		if (c.virtuality !== '' && c.expression.trim() === '') {
			return { ok: false, error: tr.t('Column {name} needs an expression.', { name: c.name }) };
		}
	}
	return { ok: true, columns };
}

export type CreateTableResult =
	{ ok: true; table: string; sql: string } | { ok: false; error: string };

export async function createTable(
	dbi: DatabaseInterface,
	db: string,
	rawInput: unknown,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<CreateTableResult> {
	const parsed = createTableSchema.safeParse(rawInput);
	if (!parsed.success) return { ok: false, error: tr.t(parsed.error.issues[0].message) };
	const input = parsed.data;
	const ctx = await getCreateTableContext(dbi);
	const { caps } = ctx;

	const checked = normalizeColumns(input.columns, caps, tr);
	if (!checked.ok) return checked;
	const columns = checked.columns;
	if (namedColumns(columns).length === 0) {
		return { ok: false, error: tr.t('The table needs at least one named column.') };
	}
	if (
		input.engine &&
		!ctx.engines.some((e) => e.name.toLowerCase() === input.engine.toLowerCase())
	) {
		return { ok: false, error: tr.t('Unknown storage engine {engine}.', { engine: input.engine }) };
	}
	if (input.collation && !ctx.collations.some((c) => c.name === input.collation)) {
		return { ok: false, error: tr.t('Unknown collation {collation}.', { collation: input.collation }) };
	}

	let table = input.name;
	const [lc] = await dbi.conn.query('SELECT @@lower_case_table_names AS v');
	if (String((lc as Record<string, unknown>[])[0]?.v) === '1') table = table.toLowerCase();
	if (table.includes('\0')) return { ok: false, error: tr.t('Invalid table name.') };

	if ((await dbi.getTableType(db, table)) !== null) {
		return { ok: false, error: tr.t('Table {table} already exists!', { table }) };
	}

	const sql = buildCreateTable(
		db,
		{ name: table, engine: input.engine, collation: input.collation, comment: input.comment },
		columns,
		caps
	);
	try {
		await dbi.conn.query(sql);
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	return { ok: true, table, sql };
}
