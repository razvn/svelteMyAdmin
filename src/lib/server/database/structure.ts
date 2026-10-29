/**
 * Database > Structure (Controllers/Database/StructureController.php and Controllers/Database/Structure/*).
 */
import { z } from 'zod';
import { N_, SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';
import type { DatabaseInterface } from '../db/dbi';
import { escapeId, escapeQualified } from '../db/escape';

export const SORT_KEYS = [
	'name',
	'rows',
	'engine',
	'collation',
	'size',
	'overhead',
	'comment'
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortOrder = 'asc' | 'desc';

export interface TableRow {
	name: string;
	isView: boolean;
	engine: string | null;
	/** Displayed row count; null when unknown (shown as "-"). */
	rows: number | null;
	/** Row count is an estimate (shown as `~N`). */
	approx: boolean;
	/** Views: "at least this number of rows" hint (MaxExactCountViews). */
	viewHint: boolean;
	collation: string | null;
	/** Data + index bytes; null when unknown for the engine. */
	size: number | null;
	overhead: number;
	comment: string;
	/** ENGINE is NULL on a base table: needs repair, PHP shows "in use". */
	inUse: boolean;
}

export interface RawTable {
	name: string;
	type: string;
	engine: string | null;
	tableRows: number | null;
	dataLength: number;
	indexLength: number;
	dataFree: number;
	collation: string | null;
	comment: string;
}

const EXACT_ESTIMATE_ENGINES = ['MyISAM', 'ISAM', 'HEAP', 'MEMORY', 'ARCHIVE', 'Aria', 'Maria'];
const SIZED_ENGINES = ['InnoDB', 'PBMS', 'TokuDB', 'ROCKSDB', 'CSV', 'Mroonga'];
const APPROX_ENGINES = ['CSV', 'InnoDB', 'TokuDB'];

export const isViewType = (type: string): boolean => type === 'VIEW' || type === 'SYSTEM VIEW';

/** Size and overhead per engine, like getStuffForEngineTypeTable(). */
export function sizeAndOverhead(
	engine: string | null,
	dataLength: number,
	indexLength: number,
	dataFree: number
): { size: number | null; overhead: number } {
	if (engine && EXACT_ESTIMATE_ENGINES.includes(engine)) {
		return { size: dataLength + indexLength, overhead: dataFree > 0 ? dataFree : 0 };
	}
	if (engine && SIZED_ENGINES.includes(engine)) {
		return { size: dataLength + indexLength, overhead: 0 };
	}
	return { size: null, overhead: 0 };
}

/**
 * Does the row count of a base table need a real `COUNT(*)`? InnoDB/TokuDB: only when the
 * estimate is below MaxExactCount (or missing); CSV always. Other engines report exact numbers.
 */
export function needsExactCount(
	engine: string | null,
	tableRows: number | null,
	maxExactCount: number
): boolean {
	if (!engine) return false;
	if (engine === 'CSV') return true;
	if (engine === 'InnoDB' || engine === 'TokuDB') {
		return tableRows === null || tableRows < maxExactCount;
	}
	return false;
}

/** isRowCountApproximated() for base tables: an uncounted InnoDB/CSV/TokuDB number is `~`. */
export function isApproximate(engine: string | null, isView: boolean, counted: boolean): boolean {
	return !isView && !!engine && APPROX_ENGINES.includes(engine) && !counted;
}

/** Text for the rows cell. */
export function formatRows(
	row: Pick<TableRow, 'rows' | 'approx'>,
	format: (n: number) => string
): string {
	if (row.rows === null) return '-';
	return (row.approx ? '~' : '') + format(row.rows);
}

export const querySchema = z.object({
	sort: z.enum(SORT_KEYS).catch('name').default('name'),
	sort_order: z
		.string()
		.transform((v) => (v.toLowerCase() === 'desc' ? ('desc' as const) : ('asc' as const)))
		.default('asc'),
	pos: z.coerce.number().int().min(0).catch(0).default(0)
});

export function parseQuery(params: URLSearchParams) {
	return querySchema.parse({
		sort: params.get('sort') ?? undefined,
		sort_order: params.get('sort_order') ?? undefined,
		pos: params.get('pos') ?? undefined
	});
}

function sortValue(t: RawTable, key: SortKey): string | number {
	const so = sizeAndOverhead(t.engine, t.dataLength, t.indexLength, t.dataFree);
	switch (key) {
		case 'name':
			return t.name;
		case 'rows':
			return t.tableRows ?? -1;
		case 'engine':
			return t.engine ?? '';
		case 'collation':
			return t.collation ?? '';
		case 'size':
			return so.size ?? -1;
		case 'overhead':
			return so.overhead;
		case 'comment':
			return t.comment;
	}
}

export function sortTables(tables: RawTable[], key: SortKey, order: SortOrder): RawTable[] {
	const dir = order === 'desc' ? -1 : 1;
	const text = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
	return [...tables].sort((a, b) => {
		const x = sortValue(a, key);
		const y = sortValue(b, key);
		let c = typeof x === 'number' && typeof y === 'number' ? x - y : text(String(x), String(y));
		if (c === 0) c = text(a.name, b.name);
		return c * dir;
	});
}

export async function loadRawTables(dbi: DatabaseInterface, db: string): Promise<RawTable[]> {
	const [rows] = await dbi.conn.query(
		'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_ROWS AS table_rows, ' +
			'DATA_LENGTH AS data_length, INDEX_LENGTH AS index_length, DATA_FREE AS data_free, ' +
			'TABLE_COLLATION AS collation, TABLE_COMMENT AS comment ' +
			'FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
		[db]
	);
	const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
	const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));
	return (rows as Record<string, unknown>[]).map((r) => ({
		name: String(r.name),
		type: String(r.type),
		engine: strOrNull(r.engine),
		tableRows: r.table_rows === null || r.table_rows === undefined ? null : Number(r.table_rows),
		dataLength: num(r.data_length),
		indexLength: num(r.index_length),
		dataFree: num(r.data_free),
		collation: strOrNull(r.collation),
		comment: String(r.comment ?? '')
	}));
}

export interface StructureOptions {
	maxExactCount: number;
	maxExactCountViews: number;
}

/** Resolve the displayed row count of one table or view (Table::countRecords()). */
export async function resolveRow(
	dbi: DatabaseInterface,
	db: string,
	t: RawTable,
	opts: StructureOptions
): Promise<TableRow> {
	const isView = isViewType(t.type);
	const { size, overhead } = isView
		? { size: null, overhead: 0 }
		: sizeAndOverhead(t.engine, t.dataLength, t.indexLength, t.dataFree);
	const base: TableRow = {
		name: t.name,
		isView,
		engine: t.engine,
		rows: t.tableRows,
		approx: false,
		viewHint: false,
		collation: t.collation,
		size,
		overhead,
		comment: t.comment,
		inUse: !isView && t.engine === null
	};
	if (base.inUse) return { ...base, rows: null };
	if (isView) {
		if (opts.maxExactCountViews <= 0) return { ...base, rows: null };
		try {
			const [rows] = await dbi.conn.query(
				`SELECT 1 FROM ${escapeQualified(db, t.name)} LIMIT ${Math.floor(opts.maxExactCountViews)}`
			);
			const n = (rows as unknown[]).length;
			const atLeast = n >= opts.maxExactCountViews;
			return { ...base, rows: n, approx: atLeast, viewHint: atLeast };
		} catch {
			return { ...base, rows: null };
		}
	}
	if (needsExactCount(t.engine, t.tableRows, opts.maxExactCount)) {
		try {
			const [rows] = await dbi.conn.query(
				`SELECT COUNT(*) AS c FROM ${escapeQualified(db, t.name)}`
			);
			const c = Number((rows as Record<string, unknown>[])[0]?.c ?? 0);
			return { ...base, rows: c, approx: isApproximate(t.engine, false, true) };
		} catch {
			return { ...base, rows: t.tableRows, approx: true };
		}
	}
	return {
		...base,
		rows: t.tableRows ?? 0,
		approx: isApproximate(t.engine, false, false)
	};
}

export interface StructureData {
	rows: TableRow[];
	total: number;
	pos: number;
	sums: { tables: number; rows: number; size: number; overhead: number; approxRows: boolean };
}

export async function getStructure(
	dbi: DatabaseInterface,
	db: string,
	opts: StructureOptions & {
		sort: SortKey;
		sortOrder: SortOrder;
		pos: number;
		maxTableList: number;
	}
): Promise<StructureData> {
	const all = sortTables(await loadRawTables(dbi, db), opts.sort, opts.sortOrder);
	const pos = opts.pos >= all.length ? Math.max(0, all.length - opts.maxTableList) : opts.pos;
	const page = opts.maxTableList > 0 ? all.slice(pos, pos + opts.maxTableList) : all;
	const rows: TableRow[] = [];
	for (const t of page) rows.push(await resolveRow(dbi, db, t, opts));
	const sums = { tables: all.length, rows: 0, size: 0, overhead: 0, approxRows: false };
	for (const r of rows) {
		sums.rows += r.rows ?? 0;
		sums.size += r.size ?? 0;
		sums.overhead += r.overhead;
		sums.approxRows ||= r.approx;
	}
	return { rows, total: all.length, pos, sums };
}

// ---------------------------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------------------------

export const OPS = [
	'empty',
	'drop',
	'check',
	'optimize',
	'repair',
	'analyze',
	'checksum',
	'add_prefix',
	'replace_prefix',
	'copy_prefix',
	'show_create'
] as const;
export type Op = (typeof OPS)[number];
export const MAINTENANCE_OPS = ['check', 'optimize', 'repair', 'analyze', 'checksum'] as const;
export type MaintenanceOp = (typeof MAINTENANCE_OPS)[number];

export const operationSchema = z.object({
	op: z.enum(OPS),
	selected: z.array(z.string().min(1).max(64)).min(1, N_('No table selected.')),
	fk_checks: z.boolean().default(true),
	prefix: z.string().max(64).default(''),
	from_prefix: z.string().max(64).default(''),
	to_prefix: z.string().max(64).default(''),
	drop_if_exists: z.boolean().default(false)
});
export type OperationInput = z.infer<typeof operationSchema>;

export function parseOperation(form: FormData) {
	return operationSchema.safeParse({
		op: form.get('op') ?? undefined,
		selected: form.getAll('selected').map(String),
		fk_checks: form.get('fk_checks') !== '0',
		prefix: String(form.get('prefix') ?? ''),
		from_prefix: String(form.get('from_prefix') ?? ''),
		to_prefix: String(form.get('to_prefix') ?? ''),
		drop_if_exists: form.get('drop_if_exists') === '1'
	});
}

export interface Rename {
	from: string;
	to: string;
}

/** Add prefix: every selected name becomes `prefix + name`. */
export function planAddPrefix(names: string[], prefix: string): Rename[] {
	return names.map((from) => ({ from, to: prefix + from }));
}

/**
 * Replace prefix: names starting with `fromPrefix` get `toPrefix` instead; the others are kept
 * (and therefore not listed).
 */
export function planReplacePrefix(names: string[], fromPrefix: string, toPrefix: string): Rename[] {
	const out: Rename[] = [];
	for (const from of names) {
		if (!from.startsWith(fromPrefix)) continue;
		const to = toPrefix + from.slice(fromPrefix.length);
		if (to !== from) out.push({ from, to });
	}
	return out;
}

/** Validate target names: non-empty, <= 64 chars, no path characters, unique, not existing. */
export function validateRenames(
	renames: Rename[],
	existing: string[],
	opts: { allowExisting?: boolean } = {},
	tr: Translator = SOURCE_TRANSLATOR
): string | null {
	if (renames.length === 0) return tr.t('No table name would change.');
	const seen = new Set<string>();
	const moving = new Set(renames.map((r) => r.from));
	for (const { to } of renames) {
		if (to === '' || [...to].length > 64) return tr.t('Invalid table name: {name}', { name: to });
		if (/[\0/\\.]/.test(to) || to.endsWith(' ')) return tr.t('Invalid table name: {name}', { name: to });
		if (seen.has(to)) return tr.t('Duplicate target table name: {name}', { name: to });
		seen.add(to);
		if (!opts.allowExisting && existing.includes(to) && !moving.has(to)) {
			return tr.t('Table {table} already exists.', { table: to });
		}
	}
	return null;
}

export interface TableRef {
	name: string;
	isView: boolean;
}

export interface Plan {
	op: Op;
	/** Statements in execution order (unqualified when `db` is null: this is the preview). */
	statements: string[];
	/** Run with FOREIGN_KEY_CHECKS=0. */
	disableFk: boolean;
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; error: string };

/** Build the SQL for a bulk operation. `db` qualifies the table names (execution); null = preview. */
export function buildPlan(
	input: OperationInput,
	tables: TableRef[],
	db: string | null,
	tr: Translator = SOURCE_TRANSLATOR
): PlanResult {
	const byName = new Map(tables.map((t) => [t.name, t]));
	const unique = [...new Set(input.selected)];
	for (const n of unique) if (!byName.has(n)) return { ok: false, error: tr.t('Unknown table: {name}', { name: n }) };
	const q = (name: string) => (db === null ? escapeId(name) : escapeQualified(db, name));
	const sel = unique.map((n) => byName.get(n)!);
	const baseTables = sel.filter((t) => !t.isView);
	const disableFk = !input.fk_checks && (input.op === 'drop' || input.op === 'empty');
	const mk = (statements: string[]): PlanResult =>
		statements.length === 0
			? { ok: false, error: tr.t('No applicable table selected.') }
			: { ok: true, plan: { op: input.op, statements, disableFk } };

	switch (input.op) {
		case 'empty':
			// views cannot be emptied
			return mk(baseTables.map((t) => `TRUNCATE ${q(t.name)}`));
		case 'drop': {
			const out: string[] = [];
			if (baseTables.length) out.push(`DROP TABLE ${baseTables.map((t) => q(t.name)).join(', ')}`);
			const views = sel.filter((t) => t.isView);
			if (views.length) out.push(`DROP VIEW ${views.map((t) => q(t.name)).join(', ')}`);
			return mk(out);
		}
		case 'check':
		case 'optimize':
		case 'repair':
		case 'analyze':
		case 'checksum': {
			// CHECK/CHECKSUM accept views; the others are table-only
			const list = input.op === 'check' || input.op === 'checksum' ? sel : baseTables;
			return mk(
				list.length
					? [`${input.op.toUpperCase()} TABLE ${list.map((t) => q(t.name)).join(', ')}`]
					: []
			);
		}
		case 'add_prefix':
		case 'replace_prefix': {
			if (input.op === 'add_prefix' && input.prefix === '') {
				return { ok: false, error: tr.t('The prefix is empty.') };
			}
			if (input.op === 'replace_prefix' && input.from_prefix === '') {
				return { ok: false, error: tr.t('The prefix to replace is empty.') };
			}
			const renames =
				input.op === 'add_prefix'
					? planAddPrefix(unique, input.prefix)
					: planReplacePrefix(unique, input.from_prefix, input.to_prefix);
			const err = validateRenames(
				renames,
				tables.map((t) => t.name),
				{},
				tr
			);
			if (err) return { ok: false, error: err };
			return mk(
				renames.map((r) =>
					byName.get(r.from)!.isView
						? `RENAME TABLE ${q(r.from)} TO ${q(r.to)}`
						: `ALTER TABLE ${q(r.from)} RENAME ${q(r.to)}`
				)
			);
		}
		case 'copy_prefix': {
			const renames = planReplacePrefix(
				baseTables.map((t) => t.name),
				input.from_prefix,
				input.to_prefix
			);
			const err = validateRenames(
				renames,
				tables.map((t) => t.name),
				{ allowExisting: input.drop_if_exists },
				tr
			);
			if (err) return { ok: false, error: err };
			const out: string[] = [];
			for (const r of renames) {
				if (input.drop_if_exists) out.push(`DROP TABLE IF EXISTS ${q(r.to)}`);
				out.push(`CREATE TABLE ${q(r.to)} LIKE ${q(r.from)}`);
				out.push(`INSERT INTO ${q(r.to)} SELECT * FROM ${q(r.from)}`);
			}
			return mk(out);
		}
		case 'show_create':
			return mk(sel.map((t) => `SHOW CREATE ${t.isView ? 'VIEW' : 'TABLE'} ${q(t.name)}`));
	}
}

export interface ResultSet {
	statement: string;
	rows: Record<string, string>[];
}

export type ExecResult =
	| { ok: true; results: ResultSet[]; executed: number }
	| { ok: false; error: string; executed: number };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Run a plan; maintenance/show statements return their result set. */
export async function executePlan(dbi: DatabaseInterface, plan: Plan): Promise<ExecResult> {
	const conn = dbi.conn;
	const results: ResultSet[] = [];
	let executed = 0;
	let previousFk: string | null = null;
	try {
		if (plan.disableFk) {
			const [r] = await conn.query('SELECT @@foreign_key_checks AS v');
			previousFk = String((r as Record<string, unknown>[])[0]?.v ?? '1');
			await conn.query('SET FOREIGN_KEY_CHECKS = 0');
		}
		for (const sql of plan.statements) {
			const [res] = await conn.query(sql);
			executed++;
			if (Array.isArray(res)) {
				results.push({
					statement: sql,
					rows: (res as Record<string, unknown>[]).map((row) =>
						Object.fromEntries(
							Object.entries(row).map(([k, v]) => [k, v === null ? 'NULL' : String(v)])
						)
					)
				});
			}
		}
		return { ok: true, results, executed };
	} catch (e) {
		return { ok: false, error: errMsg(e), executed };
	} finally {
		if (previousFk !== null) {
			try {
				await conn.query('SET FOREIGN_KEY_CHECKS = ?', [previousFk === '0' ? 0 : 1]);
			} catch {
				// connection is gone; nothing to restore
			}
		}
	}
}
