/**
 * Tab bar definitions (see libraries/classes/Menu.php: getServerTabs / getDbTabs / getTableTabs).
 * Pure data + helpers: no framework imports, so it is shared by the server (route validation)
 * and the client (tab bars, command palette).
 */

export type TabLevel = 'server' | 'db' | 'table';

/** Roadmap phase (docs/ROADMAP.md) in which a tab gets its real implementation. */
export const PHASE_TITLES: Record<number, string> = {
	2: 'Phase 2 — Server level',
	3: 'Phase 3 — Database level',
	4: 'Phase 4 — Table level',
	5: 'Phase 5 — SQL engine & editor',
	6: 'Phase 6 — Import / Export',
	7: 'Phase 7 — Users & privileges',
	8: 'Phase 8 — Configuration storage features',
	9: 'Phase 9 — Advanced'
};

export interface TabDef {
	/** Stable id (also the icon key). */
	id: string;
	label: string;
	/** Path below the level root, e.g. `structure` or `status`. */
	path: string;
	/** Further sub paths that keep this tab highlighted (`status/processes`, ...). */
	also?: string[];
	/** Roadmap phase that implements it. */
	phase: number;
}

/** A routable page that has no tab of its own. */
export interface ExtraPage {
	path: string;
	label: string;
	phase: number;
}

const t = (id: string, label: string, phase: number, path = id, also?: string[]): TabDef => ({
	id,
	label,
	path,
	phase,
	...(also ? { also } : {})
});

export interface ServerTabOptions {
	/** Show "Binary log" (only when `log_bin` is ON). */
	binlog?: boolean;
}

export function serverTabs(opts: ServerTabOptions = {}): TabDef[] {
	return [
		t('databases', 'Databases', 2),
		t('sql', 'SQL', 5),
		t('status', 'Status', 2),
		t('privileges', 'User accounts', 7, 'privileges', ['user-groups']),
		t('export', 'Export', 6),
		t('import', 'Import', 6),
		t('settings', 'Settings', 8),
		...(opts.binlog ? [t('binlog', 'Binary log', 2)] : []),
		t('replication', 'Replication', 2),
		t('variables', 'Variables', 2),
		t('charsets', 'Charsets', 2),
		t('engines', 'Engines', 2),
		t('plugins', 'Plugins', 2)
	];
}

export interface DbTabOptions {
	/** Tracking needs the configuration storage. Default true. */
	tracking?: boolean;
	/** Central columns need the configuration storage. Default true. */
	centralColumns?: boolean;
}

export function dbTabs(opts: DbTabOptions = {}): TabDef[] {
	return [
		t('structure', 'Structure', 3),
		t('sql', 'SQL', 5),
		t('search', 'Search', 3),
		t('query', 'Query', 3),
		t('export', 'Export', 6),
		t('import', 'Import', 6),
		t('operations', 'Operations', 3),
		t('privileges', 'Privileges', 7),
		t('routines', 'Routines', 3),
		t('events', 'Events', 3),
		t('triggers', 'Triggers', 3),
		...(opts.tracking === false ? [] : [t('tracking', 'Tracking', 8)]),
		t('designer', 'Designer', 9),
		...(opts.centralColumns === false
			? []
			: [t('central-columns', 'Central columns', 8, 'central-columns')])
	];
}

export interface TableTabOptions {
	isView: boolean;
	tracking?: boolean;
}

/** Views have a reduced set (Menu.php: no Insert, Import, Triggers). */
export function tableTabs(opts: TableTabOptions): TabDef[] {
	const { isView } = opts;
	return [
		t('browse', 'Browse', 4),
		t('structure', 'Structure', 4, 'structure', ['relation', 'indexes', 'partitions']),
		t('sql', 'SQL', 5),
		t('search', 'Search', 4, 'search', ['zoom-search', 'find-replace']),
		...(isView ? [] : [t('insert', 'Insert', 4)]),
		t('export', 'Export', 6),
		...(isView ? [] : [t('import', 'Import', 6)]),
		t('privileges', 'Privileges', 7),
		t('operations', 'Operations', 4),
		...(opts.tracking === false ? [] : [t('tracking', 'Tracking', 8)]),
		...(isView ? [] : [t('triggers', 'Triggers', 4)])
	];
}

const SERVER_EXTRA: ExtraPage[] = [
	{ path: 'status/processes', label: 'Processes', phase: 2 },
	{ path: 'status/monitor', label: 'Monitor', phase: 9 },
	{ path: 'status/queries', label: 'Query statistics', phase: 2 },
	{ path: 'status/variables', label: 'Status variables', phase: 2 },
	{ path: 'status/advisor', label: 'Advisor', phase: 9 },
	{ path: 'user-groups', label: 'User groups', phase: 7 },
	{ path: 'user-password', label: 'Change password', phase: 7 }
];
const DB_EXTRA: ExtraPage[] = [{ path: 'data-dictionary', label: 'Data dictionary', phase: 3 }];
const TABLE_EXTRA: ExtraPage[] = [{ path: 'chart', label: 'Chart', phase: 4 }];

/** Every tab (conditional ones included) and sub page of a level, for routing and titles. */
function allPages(level: TabLevel): (ExtraPage & { tab?: TabDef })[] {
	const tabs =
		level === 'server'
			? serverTabs({ binlog: true })
			: level === 'db'
				? dbTabs()
				: tableTabs({ isView: false });
	const extra = level === 'server' ? SERVER_EXTRA : level === 'db' ? DB_EXTRA : TABLE_EXTRA;
	const pages: (ExtraPage & { tab?: TabDef })[] = [];
	for (const tab of tabs) {
		pages.push({ path: tab.path, label: tab.label, phase: tab.phase, tab });
		for (const p of tab.also ?? []) {
			pages.push({ path: p, label: tab.label, phase: tab.phase, tab });
		}
	}
	return [...pages, ...extra];
}

/** Page definition for a path below the level root, or undefined for unknown ones. */
export function findPage(
	level: TabLevel,
	path: string
): (ExtraPage & { tab?: TabDef }) | undefined {
	return allPages(level).find((p) => p.path === path);
}

/**
 * Is `path` a routable page of this level? Views reject the table-only pages
 * (insert, import, triggers).
 */
export function isValidTab(
	level: TabLevel,
	path: string,
	opts: { isView?: boolean } = {}
): boolean {
	const page = findPage(level, path);
	if (!page) return false;
	if (level === 'table' && opts.isView) {
		const root = path.split('/')[0];
		return tableTabs({ isView: true }).some((tab) => tab.path === root) || !page.tab;
	}
	return true;
}

/** Is `tab` the highlighted one while viewing `current` (a path below the level root)? */
export function isTabActive(tab: TabDef, current: string): boolean {
	const candidates = [tab.path, ...(tab.also ?? [])];
	return candidates.some((p) => current === p || current.startsWith(`${p}/`));
}

export interface TabContext {
	db?: string;
	table?: string;
}

/** Root URL of a level, without trailing slash. */
export function levelRoot(level: TabLevel, ctx: TabContext = {}): string {
	if (level === 'server') return '/server';
	const db = encodeURIComponent(ctx.db ?? '');
	if (level === 'db') return `/db/${db}`;
	return `/db/${db}/table/${encodeURIComponent(ctx.table ?? '')}`;
}

export function tabHref(level: TabLevel, ctx: TabContext, path: string): string {
	return `${levelRoot(level, ctx)}/${path}`;
}

/** Path below the level root of an absolute pathname, or '' when outside the level. */
export function currentTabPath(level: TabLevel, ctx: TabContext, pathname: string): string {
	const root = `${levelRoot(level, ctx)}/`;
	return pathname.startsWith(root) ? pathname.slice(root.length).replace(/\/+$/, '') : '';
}

/** Short subtitle used by placeholders and the command palette. */
export function phaseTitle(phase: number): string {
	return PHASE_TITLES[phase] ?? `Phase ${phase}`;
}
