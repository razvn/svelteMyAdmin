/**
 * Server > Databases (Controllers/Server/DatabasesController.php, Databases/CreateController.php,
 * Databases/DestroyController.php, DatabaseInterface::getDatabasesFull()).
 */
import { z } from 'zod';
import type { DatabaseInterface } from '../db/dbi';
import { escapeId } from '../db/escape';
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';

export const SORT_COLUMNS = [
	'SCHEMA_NAME',
	'DEFAULT_COLLATION_NAME',
	'SCHEMA_TABLES',
	'SCHEMA_TABLE_ROWS',
	'SCHEMA_DATA_LENGTH',
	'SCHEMA_INDEX_LENGTH',
	'SCHEMA_LENGTH',
	'SCHEMA_DATA_FREE'
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortOrder = 'asc' | 'desc';

export const STAT_COLUMNS = [
	'SCHEMA_TABLES',
	'SCHEMA_TABLE_ROWS',
	'SCHEMA_DATA_LENGTH',
	'SCHEMA_INDEX_LENGTH',
	'SCHEMA_LENGTH',
	'SCHEMA_DATA_FREE'
] as const;
export type StatColumn = (typeof STAT_COLUMNS)[number];
export type Stats = Record<StatColumn, number>;

export interface DatabaseRow {
	name: string;
	collation: string;
	isSystemSchema: boolean;
	isPmadb: boolean;
	/** Present only when statistics are enabled. */
	stats: Stats | null;
}

export const emptyStats = (): Stats => ({
	SCHEMA_TABLES: 0,
	SCHEMA_TABLE_ROWS: 0,
	SCHEMA_DATA_LENGTH: 0,
	SCHEMA_INDEX_LENGTH: 0,
	SCHEMA_LENGTH: 0,
	SCHEMA_DATA_FREE: 0
});

/** Utilities::isSystemSchema($name, true). */
export function isSystemSchema(name: string): boolean {
	return ['information_schema', 'performance_schema', 'mysql', 'sys'].includes(name.toLowerCase());
}

export const querySchema = z.object({
	statistics: z
		.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('')])
		.optional()
		.transform((v) => v === '1' || v === 'true'),
	pos: z.coerce.number().int().min(0).catch(0).default(0),
	sort_by: z.enum(SORT_COLUMNS).catch('SCHEMA_NAME').default('SCHEMA_NAME'),
	sort_order: z
		.string()
		.transform((v) => (v.toLowerCase() === 'desc' ? ('desc' as const) : ('asc' as const)))
		.default('asc')
});

export function parseQuery(params: URLSearchParams) {
	const raw = {
		statistics: params.get('statistics') ?? undefined,
		pos: params.get('pos') ?? undefined,
		sort_by: params.get('sort_by') ?? undefined,
		sort_order: params.get('sort_order') ?? undefined
	};
	return querySchema.parse(raw);
}

/** Sum the statistics of a set of rows (the "Total:" footer). */
export function sumStats(rows: Pick<DatabaseRow, 'stats'>[]): Stats {
	const total = emptyStats();
	for (const r of rows) {
		if (!r.stats) continue;
		for (const k of STAT_COLUMNS) total[k] += r.stats[k];
	}
	return total;
}

export function sortDatabases(
	rows: DatabaseRow[],
	by: SortColumn,
	order: SortOrder
): DatabaseRow[] {
	const dir = order === 'desc' ? -1 : 1;
	const text = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
	return [...rows].sort((a, b) => {
		let c: number;
		if (by === 'SCHEMA_NAME') c = text(a.name, b.name);
		else if (by === 'DEFAULT_COLLATION_NAME') c = text(a.collation, b.collation);
		else c = (a.stats?.[by] ?? 0) - (b.stats?.[by] ?? 0);
		if (c === 0) c = text(a.name, b.name);
		return c * dir;
	});
}

export function paginate<T>(rows: T[], pos: number, max: number): T[] {
	return max > 0 ? rows.slice(pos, pos + max) : rows;
}

/** Aggregated statistics per schema (InnoDB `DATA_FREE` is free space, not overhead: excluded). */
async function loadStats(dbi: DatabaseInterface): Promise<Map<string, Stats>> {
	const [rows] = await dbi.conn.query(
		'SELECT TABLE_SCHEMA AS name, COUNT(*) AS tables_, SUM(TABLE_ROWS) AS table_rows, ' +
			'SUM(DATA_LENGTH) AS data_length, SUM(INDEX_LENGTH) AS index_length, ' +
			'SUM(DATA_LENGTH + INDEX_LENGTH) AS total_length, ' +
			"SUM(IF(ENGINE = 'InnoDB', 0, IFNULL(DATA_FREE, 0))) AS data_free " +
			'FROM information_schema.TABLES GROUP BY TABLE_SCHEMA'
	);
	const out = new Map<string, Stats>();
	for (const r of rows as Record<string, unknown>[]) {
		out.set(String(r.name), {
			SCHEMA_TABLES: Number(r.tables_ ?? 0),
			SCHEMA_TABLE_ROWS: Number(r.table_rows ?? 0),
			SCHEMA_DATA_LENGTH: Number(r.data_length ?? 0),
			SCHEMA_INDEX_LENGTH: Number(r.index_length ?? 0),
			SCHEMA_LENGTH: Number(r.total_length ?? 0),
			SCHEMA_DATA_FREE: Number(r.data_free ?? 0)
		});
	}
	return out;
}

/** All visible databases with their default collation (and statistics when asked), sorted. */
export async function listDatabasesFull(
	dbi: DatabaseInterface,
	opts: { statistics: boolean; sortBy: SortColumn; sortOrder: SortOrder; pmadb?: string }
): Promise<DatabaseRow[]> {
	const visible = new Set(await dbi.listDatabases());
	const [rows] = await dbi.conn.query(
		'SELECT SCHEMA_NAME AS name, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA'
	);
	const stats = opts.statistics ? await loadStats(dbi) : null;
	const list: DatabaseRow[] = [];
	for (const r of rows as Record<string, unknown>[]) {
		const name = String(r.name);
		if (!visible.has(name)) continue;
		list.push({
			name,
			collation: String(r.collation ?? ''),
			isSystemSchema: isSystemSchema(name),
			isPmadb: !!opts.pmadb && name === opts.pmadb,
			stats: stats ? (stats.get(name) ?? emptyStats()) : null
		});
	}
	return sortDatabases(list, opts.sortBy, opts.sortOrder);
}

export async function getServerCollation(dbi: DatabaseInterface): Promise<string> {
	const [rows] = await dbi.conn.query('SELECT @@collation_server AS v');
	return String((rows as Record<string, unknown>[])[0]?.v ?? '');
}

export interface ServerPrivileges {
	isSuperUser: boolean;
	canCreateDb: boolean;
}

/** Parse `SHOW GRANTS` lines: global `ALL`/`SUPER`/`CREATE`, or a `CREATE` grant on any schema. */
export function parseGrants(grants: string[]): ServerPrivileges {
	let isSuperUser = false;
	let canCreateDb = false;
	for (const g of grants) {
		const m = /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s/is.exec(g);
		if (!m) continue;
		const privs = m[1].toUpperCase().split(/\s*,\s*/);
		const global = /^(\*|`?\*`?)\.(\*|`\*`)$/.test(m[2]);
		const all = privs.includes('ALL PRIVILEGES') || privs.includes('ALL');
		if (global && (all || privs.includes('SUPER'))) isSuperUser = true;
		if (all || privs.includes('CREATE')) canCreateDb = true;
	}
	return { isSuperUser, canCreateDb };
}

export async function getServerPrivileges(dbi: DatabaseInterface): Promise<ServerPrivileges> {
	try {
		const [rows] = await dbi.conn.query('SHOW GRANTS FOR CURRENT_USER()');
		return parseGrants((rows as Record<string, unknown>[]).map((r) => String(Object.values(r)[0])));
	} catch {
		return { isSuperUser: false, canCreateDb: false };
	}
}

export const createSchema = z.object({
	new_db: z.string().min(1).max(64),
	db_collation: z.string().max(64).optional().default('')
});

export type CreateResult = { ok: true; name: string } | { ok: false; error: string };

export async function createDatabase(
	dbi: DatabaseInterface,
	input: { new_db: string; db_collation?: string },
	i18n: Translator = SOURCE_TRANSLATOR
): Promise<CreateResult> {
	const { t } = i18n;
	const parsed = createSchema.safeParse(input);
	if (!parsed.success) {
		return {
			ok: false,
			error: input.new_db === '' ? t('The database name is empty!') : t('Name is too long.')
		};
	}
	let name = parsed.data.new_db;
	if (name.includes('\0')) return { ok: false, error: t('Invalid database name.') };
	const [lc] = await dbi.conn.query('SELECT @@lower_case_table_names AS v');
	if (String((lc as Record<string, unknown>[])[0]?.v) === '1') name = name.toLowerCase();
	let sql = `CREATE DATABASE ${escapeId(name)}`;
	const collation = parsed.data.db_collation;
	if (collation) {
		const known = (await dbi.listCollations()).find((c) => c.name === collation);
		if (known)
			sql += ` DEFAULT CHARACTER SET ${escapeId(known.charset)} COLLATE ${escapeId(known.name)}`;
	}
	try {
		await dbi.conn.query(sql);
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	return { ok: true, name };
}

export const dropSchema = z.object({
	selected_dbs: z.array(z.string().min(1).max(64)).min(1)
});

export type DropResult =
	{ ok: true; dropped: string[]; skipped: string[] } | { ok: false; error: string };

/** Drop the selected databases; system schemas and the configuration storage db are skipped. */
export async function dropDatabases(
	dbi: DatabaseInterface,
	names: string[],
	opts: { pmadb?: string } = {},
	i18n: Translator = SOURCE_TRANSLATOR
): Promise<DropResult> {
	const { t } = i18n;
	const parsed = dropSchema.safeParse({ selected_dbs: names });
	if (!parsed.success) return { ok: false, error: t('No databases selected.') };
	const skipped: string[] = [];
	const todo: string[] = [];
	for (const n of new Set(parsed.data.selected_dbs)) {
		if (isSystemSchema(n) || (opts.pmadb && n === opts.pmadb)) skipped.push(n);
		else todo.push(n);
	}
	if (todo.length === 0) {
		return { ok: false, error: t('System databases cannot be dropped.') };
	}
	const dropped: string[] = [];
	for (const n of todo) {
		try {
			await dbi.conn.query(`DROP DATABASE ${escapeId(n)}`);
			dropped.push(n);
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) };
		}
	}
	return { ok: true, dropped, skipped };
}
