/**
 * Tab bar definitions (see libraries/classes/Menu.php: getServerTabs / getDbTabs / getTableTabs).
 * Pure data + helpers: no framework imports, so it is shared by the server (route validation)
 * and the client (tab bars, command palette).
 */

import { N_ } from '#lib/i18n/translator.ts';

export type TabLevel = 'server' | 'db' | 'table';

/** Roadmap phase (docs/ROADMAP.md) in which a tab gets its real implementation. */
export const PHASE_TITLES: Record<number, string> = {
	2: N_('Phase 2 — Server level'),
	3: N_('Phase 3 — Database level'),
	4: N_('Phase 4 — Table level'),
	5: N_('Phase 5 — SQL engine & editor'),
	6: N_('Phase 6 — Import / Export'),
	7: N_('Phase 7 — Users & privileges'),
	8: N_('Phase 8 — Configuration storage features'),
	9: N_('Phase 9 — Advanced')
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

const def = (id: string, label: string, phase: number, path = id, also?: string[]): TabDef => ({
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
		def('databases', N_('Databases'), 2),
		def('sql', N_('SQL'), 5),
		def('status', N_('Status'), 2),
		def('privileges', N_('User accounts'), 7, 'privileges', ['user-groups']),
		def('export', N_('Export'), 6),
		def('import', N_('Import'), 6),
		def('settings', N_('Settings'), 8),
		...(opts.binlog ? [def('binlog', N_('Binary log'), 2)] : []),
		def('replication', N_('Replication'), 2),
		def('variables', N_('Variables'), 2),
		def('charsets', N_('Charsets'), 2),
		def('engines', N_('Engines'), 2),
		def('plugins', N_('Plugins'), 2)
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
		def('structure', N_('Structure'), 3),
		def('sql', N_('SQL'), 5),
		def('search', N_('Search'), 3),
		def('query', N_('Query'), 3),
		def('export', N_('Export'), 6),
		def('import', N_('Import'), 6),
		def('operations', N_('Operations'), 3),
		def('privileges', N_('Privileges'), 7),
		def('routines', N_('Routines'), 3),
		def('events', N_('Events'), 3),
		def('triggers', N_('Triggers'), 3),
		...(opts.tracking === false ? [] : [def('tracking', N_('Tracking'), 8)]),
		def('designer', N_('Designer'), 9),
		...(opts.centralColumns === false
			? []
			: [def('central-columns', N_('Central columns'), 8, 'central-columns')])
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
		def('browse', N_('Browse'), 4),
		def('structure', N_('Structure'), 4, 'structure', ['relation', 'indexes', 'partitions']),
		def('sql', N_('SQL'), 5),
		def('search', N_('Search'), 4, 'search', ['zoom-search', 'find-replace']),
		...(isView ? [] : [def('insert', N_('Insert'), 4)]),
		def('export', N_('Export'), 6),
		...(isView ? [] : [def('import', N_('Import'), 6)]),
		def('privileges', N_('Privileges'), 7),
		def('operations', N_('Operations'), 4),
		...(opts.tracking === false ? [] : [def('tracking', N_('Tracking'), 8)]),
		...(isView ? [] : [def('triggers', N_('Triggers'), 4)])
	];
}

const SERVER_EXTRA: ExtraPage[] = [
	{ path: 'status/processes', label: N_('Processes'), phase: 2 },
	{ path: 'status/monitor', label: N_('Monitor'), phase: 9 },
	{ path: 'status/queries', label: N_('Query statistics'), phase: 2 },
	{ path: 'status/variables', label: N_('Status variables'), phase: 2 },
	{ path: 'status/advisor', label: N_('Advisor'), phase: 9 },
	{ path: 'user-groups', label: N_('User groups'), phase: 7 },
	{ path: 'user-password', label: N_('Change password'), phase: 7 }
];
const DB_EXTRA: ExtraPage[] = [{ path: 'data-dictionary', label: N_('Data dictionary'), phase: 3 }];
const TABLE_EXTRA: ExtraPage[] = [{ path: 'chart', label: N_('Chart'), phase: 4 }];

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
