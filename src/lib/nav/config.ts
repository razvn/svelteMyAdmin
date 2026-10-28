/** Subset of the phpMyAdmin `Navigation*` / `DefaultTab*` settings the browser needs. */
export interface NavConfig {
	groupingEnabled: boolean;
	dbSeparator: string;
	dbFilterMinimum: number;
	itemFilterMinimum: number;
	maxItems: number;
	/** `FirstLevelNavigationItems`: databases shown before "Show more". */
	firstLevelItems: number;
	/** `DefaultTabTable`: where a table name in the tree / breadcrumbs leads. */
	defaultTabTable: string;
	/** `NavigationTreeDefaultTabTable`: target of the quick-access icon next to a table. */
	quickTabTable: string;
	defaultTabDatabase: string;
	/** Path below `/server/`, or '' for the home page (`DefaultTabServer` = welcome). */
	defaultTabServer: string;
	showTables: boolean;
	showViews: boolean;
	showFunctions: boolean;
	showProcedures: boolean;
	showEvents: boolean;
	expansionEnabled: boolean;
	autoexpandSingleDb: boolean;
	width: number;
	displayLogo: boolean;
}

const DB_TABS = ['structure', 'sql', 'search', 'operations'];
const TABLE_TABS = ['structure', 'sql', 'search', 'insert', 'browse'];
const SERVER_TABS: Record<string, string> = {
	welcome: '',
	databases: 'databases',
	status: 'status',
	variables: 'variables',
	privileges: 'privileges'
};

export function resolveDbTab(value: string): string {
	return DB_TABS.includes(value) ? value : 'structure';
}
export function resolveTableTab(value: string): string {
	return TABLE_TABS.includes(value) ? value : 'browse';
}
export function resolveServerTab(value: string): string {
	return SERVER_TABS[value] ?? '';
}

export const DEFAULT_NAV_CONFIG: NavConfig = {
	groupingEnabled: true,
	dbSeparator: '_',
	dbFilterMinimum: 30,
	itemFilterMinimum: 30,
	maxItems: 50,
	firstLevelItems: 100,
	defaultTabTable: 'browse',
	quickTabTable: 'structure',
	defaultTabDatabase: 'structure',
	defaultTabServer: '',
	showTables: true,
	showViews: true,
	showFunctions: true,
	showProcedures: true,
	showEvents: true,
	expansionEnabled: true,
	autoexpandSingleDb: true,
	width: 240,
	displayLogo: true
};

export const serverHref = (nav: Pick<NavConfig, 'defaultTabServer'>) =>
	nav.defaultTabServer ? `/server/${nav.defaultTabServer}` : '/';
export const dbHref = (nav: Pick<NavConfig, 'defaultTabDatabase'>, db: string) =>
	`/db/${encodeURIComponent(db)}/${nav.defaultTabDatabase}`;
export const tableHref = (nav: Pick<NavConfig, 'defaultTabTable'>, db: string, table: string) =>
	`/db/${encodeURIComponent(db)}/table/${encodeURIComponent(table)}/${nav.defaultTabTable}`;
