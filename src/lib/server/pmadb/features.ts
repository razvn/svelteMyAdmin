/**
 * Configuration storage features (ConfigStorage/Relation.php: checkRelationsParam, fixPmaTables,
 * createPmaDatabase). Every feature is bound to one `pma__*` table; a feature works when its table
 * is configured and exists in the pmadb. The DDL is the verbatim `create_tables.sql` of phpMyAdmin.
 */
import type { Connection } from 'mysql2/promise';
import createTablesSql from '../../../../docker/initdb/create_tables.sql?raw';
import { escapeId, escapeQualified } from '#lib/server/db/escape.ts';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { withControl, type StorageKey } from './index.ts';

export interface FeatureDef {
	/** Config key of the server (`$cfg['Servers'][$i][key]`). */
	key: StorageKey;
	/** Default table name in create_tables.sql. */
	table: string;
	/** What the table enables (check_relations.twig). */
	enables: string;
}

/** In the order of check_relations.twig. */
export const PMA_FEATURES: readonly FeatureDef[] = [
	{ key: 'relation', table: 'pma__relation', enables: 'General relation features' },
	{ key: 'table_info', table: 'pma__table_info', enables: 'Display features' },
	{ key: 'table_coords', table: 'pma__table_coords', enables: 'Designer and creation of PDFs' },
	{ key: 'pdf_pages', table: 'pma__pdf_pages', enables: 'Designer and creation of PDFs' },
	{
		key: 'column_info',
		table: 'pma__column_info',
		enables: 'Displaying column comments, browser transformation'
	},
	{ key: 'bookmarktable', table: 'pma__bookmark', enables: 'Bookmarked SQL query' },
	{ key: 'history', table: 'pma__history', enables: 'SQL history' },
	{ key: 'recent', table: 'pma__recent', enables: 'Persistent recently used tables' },
	{ key: 'favorite', table: 'pma__favorite', enables: 'Persistent favorite tables' },
	{
		key: 'table_uiprefs',
		table: 'pma__table_uiprefs',
		enables: "Persistent tables' UI preferences"
	},
	{ key: 'tracking', table: 'pma__tracking', enables: 'Tracking' },
	{ key: 'userconfig', table: 'pma__userconfig', enables: 'User preferences' },
	{ key: 'users', table: 'pma__users', enables: 'Configurable menus' },
	{ key: 'usergroups', table: 'pma__usergroups', enables: 'Configurable menus' },
	{
		key: 'navigationhiding',
		table: 'pma__navigationhiding',
		enables: 'Hide/show navigation items'
	},
	{
		key: 'savedsearches',
		table: 'pma__savedsearches',
		enables: 'Saving Query-By-Example searches'
	},
	{
		key: 'central_columns',
		table: 'pma__central_columns',
		enables: 'Managing central list of columns'
	},
	{
		key: 'designer_settings',
		table: 'pma__designer_settings',
		enables: 'Remembering designer settings'
	},
	{ key: 'export_templates', table: 'pma__export_templates', enables: 'Saving export templates' }
];

type StorageServer = Partial<Pick<ServerConfig, StorageKey | 'pmadb'>>;

export interface FeatureStatus extends FeatureDef {
	/** Configured table name ('' = not configured). */
	name: string;
	configured: boolean;
	/** The table exists in the pmadb. */
	exists: boolean;
	ok: boolean;
}

export interface StorageStatus {
	/** `pmadb` is set in the server config. */
	configured: boolean;
	/** The configured pmadb, or phpMyAdmin's default name when none is configured. */
	pmadb: string;
	/** The pmadb could be listed (the database exists and the connection works). */
	reachable: boolean;
	features: FeatureStatus[];
	/** Every feature works. */
	allWorks: boolean;
	missing: number;
}

export const DEFAULT_PMADB = 'phpmyadmin';

/** Pure: combine the configured names with the tables found in the pmadb (null = unreachable). */
export function featureStatuses(
	server: StorageServer,
	existing: ReadonlySet<string> | null
): StorageStatus {
	const configured = !!server.pmadb;
	const features = PMA_FEATURES.map((f): FeatureStatus => {
		const name = (server[f.key] as string | undefined) ?? '';
		const isConfigured = configured && name !== '';
		const exists = isConfigured && existing !== null && existing.has(name);
		return { ...f, name, configured: isConfigured, exists, ok: exists };
	});
	const missing = features.filter((f) => !f.ok).length;
	return {
		configured,
		pmadb: server.pmadb || DEFAULT_PMADB,
		reachable: configured && existing !== null,
		features,
		allWorks: configured && missing === 0,
		missing
	};
}

/** Tables of the pmadb; null when it cannot be listed. */
export async function listPmadbTables(
	conn: Connection,
	pmadb: string
): Promise<Set<string> | null> {
	try {
		const [rows] = await conn.query(`SHOW TABLES FROM ${escapeId(pmadb)}`);
		return new Set((rows as Record<string, unknown>[]).map((r) => String(Object.values(r)[0])));
	} catch {
		return null;
	}
}

// ---- creation ----------------------------------------------------------------------------------

/** default table name -> its CREATE TABLE statement (Relation::getDefaultPmaTableNames). */
export function defaultCreateStatements(sql: string = createTablesSql): Map<string, string> {
	const out = new Map<string, string>();
	for (const part of sql.split(';')) {
		const m = /CREATE TABLE IF NOT EXISTS `(.*?)` \(/.exec(part);
		if (!m) continue;
		out.set(m[1], part.slice(part.indexOf('CREATE TABLE')).trim());
	}
	return out;
}

/** Qualified statements for the tables of `server` missing in `db` (custom table names applied). */
export function missingTableStatements(
	db: string,
	server: StorageServer,
	existing: ReadonlySet<string>,
	sql: string = createTablesSql
): { table: string; statement: string }[] {
	const defaults = defaultCreateStatements(sql);
	const out: { table: string; statement: string }[] = [];
	for (const f of PMA_FEATURES) {
		const wanted = (server[f.key] as string | undefined) || f.table;
		if (existing.has(wanted)) continue;
		const ddl = defaults.get(f.table);
		if (!ddl) continue;
		const statement = ddl.replace(
			`CREATE TABLE IF NOT EXISTS \`${f.table}\``,
			`CREATE TABLE IF NOT EXISTS ${escapeQualified(db, wanted)}`
		);
		out.push({ table: wanted, statement });
	}
	return out;
}

/** `CREATE DATABASE IF NOT EXISTS` (Relation::createPmaDatabase). */
export async function createPmaDatabase(conn: Connection, db: string): Promise<void> {
	await conn.query(
		`CREATE DATABASE IF NOT EXISTS ${escapeId(db)} DEFAULT CHARACTER SET utf8 COLLATE utf8_bin`
	);
}

/**
 * Create the missing tables in `db` (Relation::fixPmaTables). Returns the created table names.
 * Tables that are not configured fall back to their default `pma__*` name.
 */
export async function createMissingTables(
	conn: Connection,
	db: string,
	server: StorageServer
): Promise<string[]> {
	const existing = (await listPmadbTables(conn, db)) ?? new Set<string>();
	const todo = missingTableStatements(db, server, existing);
	for (const t of todo) await conn.query(t.statement);
	return todo.map((t) => t.table);
}

/** Status of the configuration storage of the active server (control connection). */
export async function getStorageStatus(locals: App.Locals): Promise<StorageStatus> {
	const server = locals.server;
	if (!server.pmadb) return featureStatuses(server, null);
	const existing = await withControl(locals, (conn) => listPmadbTables(conn, server.pmadb));
	return featureStatuses(server, existing ?? null);
}
