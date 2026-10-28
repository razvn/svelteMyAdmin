/**
 * Legacy phpMyAdmin URL -> svelteMyAdmin path (pure functions).
 *
 *   /index.php?route=/table/sql&db=x&table=y   ->  /db/x/table/y/sql
 *
 * Mirrors the routing tree in docs/ROADMAP.md. Unknown routes map to `/`.
 */

type Params = URLSearchParams | Record<string, string | undefined>;

function get(params: Params, key: string): string {
	const v = params instanceof URLSearchParams ? params.get(key) : params[key];
	return v ?? '';
}

const enc = encodeURIComponent;

const SERVER_TABS: Record<string, string> = {
	databases: 'databases',
	sql: 'sql',
	status: 'status',
	variables: 'variables',
	collations: 'charsets',
	engines: 'engines',
	plugins: 'plugins',
	privileges: 'privileges',
	binlog: 'binlog',
	replication: 'replication',
	export: 'export',
	import: 'import',
	'user-groups': 'user-groups'
};

const STATUS_TABS = new Set(['processes', 'monitor']);

const DB_TABS: Record<string, string> = {
	structure: 'structure',
	sql: 'sql',
	search: 'search',
	qbe: 'query',
	'multi-table-query': 'query',
	export: 'export',
	import: 'import',
	operations: 'operations',
	privileges: 'privileges',
	routines: 'routines',
	events: 'events',
	triggers: 'triggers',
	designer: 'designer',
	'data-dictionary': 'data-dictionary',
	'central-columns': 'central-columns',
	tracking: 'tracking'
};

const TABLE_TABS: Record<string, string> = {
	browse: 'browse',
	structure: 'structure',
	sql: 'sql',
	search: 'search',
	'zoom-search': 'zoom-search',
	'find-replace': 'find-replace',
	change: 'insert',
	export: 'export',
	import: 'import',
	operations: 'operations',
	tracking: 'tracking',
	triggers: 'triggers',
	relation: 'relation',
	indexes: 'indexes',
	partitioning: 'partitions',
	chart: 'chart'
};

const dbPath = (db: string) => `/db/${enc(db)}`;
const tablePath = (db: string, table: string) => `${dbPath(db)}/table/${enc(table)}`;

/** Path for the context-sensitive pages (export, import, sql, privileges). */
function contextual(tab: string, db: string, table: string): string {
	if (db && table) return `${tablePath(db, table)}/${tab === 'sql-browse' ? 'browse' : tab}`;
	if (db) return `${dbPath(db)}/${tab === 'sql-browse' ? 'sql' : tab}`;
	return `/server/${tab === 'sql-browse' ? 'sql' : tab}`;
}

/** Map a phpMyAdmin `route` (+ `db`, `table`) to the new path. */
export function mapLegacyRoute(params: Params): string {
	const route = get(params, 'route').replace(/\/+$/, '') || '';
	const db = get(params, 'db');
	const table = get(params, 'table');

	if (route === '') {
		// bare index.php: open the given db/table with the default tab
		if (db && table) return `${tablePath(db, table)}/browse`;
		if (db) return `${dbPath(db)}/structure`;
		return '/';
	}
	if (route === '/') return '/';

	// Context-sensitive routes
	if (route === '/export') return contextual('export', db, table);
	if (route === '/import') return contextual('import', db, table);
	if (route === '/sql') return contextual('sql-browse', db, table);

	const [, area, tab, sub] = route.split('/');
	if (area === 'server') {
		if (tab === 'status' && sub) {
			return STATUS_TABS.has(sub) ? `/server/status/${sub}` : '/server/status';
		}
		if (tab === 'privileges') return contextual('privileges', db, table);
		const mapped = Object.hasOwn(SERVER_TABS, tab ?? '') ? SERVER_TABS[tab] : undefined;
		return mapped ? `/server/${mapped}` : '/';
	}
	if (area === 'database') {
		const mapped = Object.hasOwn(DB_TABS, tab ?? '') ? DB_TABS[tab] : undefined;
		if (!mapped) return '/';
		return db ? `${dbPath(db)}/${mapped}` : '/server/databases';
	}
	if (area === 'table') {
		const mapped = Object.hasOwn(TABLE_TABS, tab ?? '') ? TABLE_TABS[tab] : undefined;
		if (!mapped) return '/';
		if (db && table) return `${tablePath(db, table)}/${mapped}`;
		return db ? `${dbPath(db)}/structure` : '/';
	}
	return '/';
}

/**
 * Redirect target for a legacy URL, or null when the URL is not a legacy one.
 * Legacy = `/index.php` (any query) or `/?route=...`.
 */
export function legacyRedirectTarget(url: URL): string | null {
	if (url.pathname === '/index.php') return mapLegacyRoute(url.searchParams);
	if (url.pathname === '/' && url.searchParams.has('route'))
		return mapLegacyRoute(url.searchParams);
	return null;
}
