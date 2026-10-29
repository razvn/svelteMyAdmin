/**
 * Menu restriction by user group (libraries/classes/Menu.php: getAllowedTabs, Util::getMenuTabList,
 * ConfigStorage/UserGroups.php). Pure helpers, shared by the server (route guard, pmadb access) and
 * the client (tab bars, group form).
 *
 * `pma__usergroups.tab` stores phpMyAdmin's tab keys (`server_rights`, `db_operation`, `table_browse`,
 * ...), which differ from our tab ids for a few tabs; the maps below keep the exact PHP names so both
 * applications can share one pmadb.
 */
import { dbTabs, findPage, serverTabs, tableTabs, type TabDef, type TabLevel } from './tabs.ts';

export const TAB_LEVELS: readonly TabLevel[] = ['server', 'db', 'table'];

/** Our tab id -> phpMyAdmin menu key, only where they differ (per level). */
const ID_TO_PMA: Record<TabLevel, Record<string, string>> = {
	server: { privileges: 'rights', variables: 'vars', charsets: 'charset', engines: 'engine' },
	db: { operations: 'operation', 'central-columns': 'central_columns' },
	table: { operations: 'operation' }
};

function invert(map: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
}

const PMA_TO_ID: Record<TabLevel, Record<string, string>> = {
	server: invert(ID_TO_PMA.server),
	db: invert(ID_TO_PMA.db),
	table: invert(ID_TO_PMA.table)
};

/** phpMyAdmin's key of a tab inside its level, e.g. server `privileges` -> `rights`. */
export function pmaTabName(level: TabLevel, id: string): string {
	return ID_TO_PMA[level][id] ?? id;
}

/** Our tab id for a phpMyAdmin menu key. */
export function tabIdFromPmaName(level: TabLevel, name: string): string {
	return PMA_TO_ID[level][name] ?? name;
}

/** Value stored in `pma__usergroups.tab`: `server_rights`, `db_operation`, `table_browse`, ... */
export function tabKey(level: TabLevel, id: string): string {
	return `${level}_${pmaTabName(level, id)}`;
}

/** Inverse of `tabKey`; null for anything that is not `server_*`, `db_*` or `table_*`. */
export function parseTabKey(key: string): { level: TabLevel; id: string } | null {
	const m = /^(server|db|table)_(.+)$/.exec(key);
	if (!m) return null;
	const level = m[1] as TabLevel;
	return { level, id: tabIdFromPmaName(level, m[2]) };
}

/** Every configurable tab of a level (Util::getMenuTabList), in phpMyAdmin's order. */
export function menuTabs(level: TabLevel): { id: string; key: string; label: string }[] {
	const tabs =
		level === 'server'
			? serverTabs({ binlog: true })
			: level === 'db'
				? dbTabs()
				: tableTabs({ isView: false });
	return tabs.map((tab) => ({ id: tab.id, key: tabKey(level, tab.id), label: tab.label }));
}

/** All configurable tab keys across the three levels. */
export function allTabKeys(): string[] {
	return TAB_LEVELS.flatMap((level) => menuTabs(level).map((t) => t.key));
}

/** Remove the tabs whose key is denied (a group row with `allowed = 'N'`). */
export function filterTabs(level: TabLevel, tabs: TabDef[], denied: readonly string[]): TabDef[] {
	if (denied.length === 0) return tabs;
	const set = new Set(denied);
	return tabs.filter((tab) => !set.has(tabKey(level, tab.id)));
}

/** Pages without a tab of their own are governed by the tab they belong to. */
const EXTRA_OWNER: Record<TabLevel, Record<string, string>> = {
	server: { 'status/': 'status', 'user-groups': 'privileges' },
	db: { 'data-dictionary': 'structure' },
	table: { chart: 'browse' }
};

/** Tab id that governs a path below the level root; null when no tab applies. */
export function governingTabId(level: TabLevel, path: string): string | null {
	const page = findPage(level, path);
	if (!page) return null;
	if (page.tab) return page.tab.id;
	for (const [prefix, id] of Object.entries(EXTRA_OWNER[level])) {
		if (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix) return id;
	}
	return null;
}

/** May a user whose group denies `denied` open this path (below the level root)? */
export function isPathAllowed(level: TabLevel, path: string, denied: readonly string[]): boolean {
	if (denied.length === 0) return true;
	const id = governingTabId(level, path);
	return id === null || !denied.includes(tabKey(level, id));
}
