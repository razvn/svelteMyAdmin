/**
 * Configuration storage entry point. Per server the backend is chosen once:
 *
 * 1. `pmadb` set: MySQL pmadb (phpMyAdmin compatible), each feature needing its configured table;
 * 2. else the top-level `ConfigStorage` of type `sqlite` (resolved by the config loader into
 *    `server.sqlite_storage`): one SQLite file, every feature available;
 * 3. else the features are off (every repository is `null`).
 *
 * Callers use the repositories (`./types.ts`) and fall back when one is missing or fails
 * (`withRepo` / `attempt`).
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { bookmarkRepo } from './mysql/bookmarks.ts';
import { centralColumnsRepo } from './mysql/central-columns.ts';
import { designerPagesRepo, designerSettingsRepo } from './mysql/designer.ts';
import { historyRepo } from './mysql/history.ts';
import { columnInfoRepo, relationRepo, tableInfoRepo } from './mysql/meta.ts';
import { exportTemplatesRepo, savedSearchesRepo, tableUiPrefsRepo } from './mysql/misc.ts';
import { navigationHidingRepo } from './mysql/navigation-hiding.ts';
import { recentFavoriteRepo } from './mysql/recent-favorite.ts';
import { controlRunner, type ControlServer, type Run } from './mysql/runner.ts';
import { trackingRepo } from './mysql/tracking.ts';
import { userConfigRepo } from './mysql/userconfig.ts';
import { userGroupsRepo } from './mysql/user-groups.ts';
import { openSqlite, SqliteStore } from './sqlite/db.ts';
import { sqliteRepos } from './sqlite/repos.ts';
import type { RepoKey, Repos } from './types.ts';

export type * from './types.ts';
export { controlRunner, connectionRunner, type Run } from './mysql/runner.ts';

/** Table keys of the server config that name a `pma__*` table. */
export type StorageKey =
	| 'bookmarktable'
	| 'relation'
	| 'table_info'
	| 'table_coords'
	| 'pdf_pages'
	| 'column_info'
	| 'history'
	| 'recent'
	| 'favorite'
	| 'table_uiprefs'
	| 'tracking'
	| 'userconfig'
	| 'users'
	| 'usergroups'
	| 'navigationhiding'
	| 'savedsearches'
	| 'central_columns'
	| 'designer_settings'
	| 'export_templates';

/** The part of a server config the storage needs. */
export type StorageServer = ControlServer &
	Pick<ServerConfig, 'pmadb'> &
	Partial<Record<StorageKey, string>> & { sqlite_storage?: string };

export type StorageKind = 'mysql' | 'sqlite' | 'none';

export function storageKind(server: Pick<ServerConfig, 'pmadb' | 'sqlite_storage'>): StorageKind {
	if (server.pmadb) return 'mysql';
	if (server.sqlite_storage) return 'sqlite';
	return 'none';
}

/**
 * Identifier of a server inside a shared SQLite file: `host:port`, or the socket path. Independent of
 * the position in `Servers`.
 */
export function storageServerId(server: Pick<ServerConfig, 'host' | 'port' | 'socket'>): string {
	if (server.socket) return `socket:${server.socket}`;
	return `${server.host || 'localhost'}:${server.port || 3306}`;
}

/** `Repos` with nothing available. */
export const noRepos = (kind: Repos['kind'] = 'mysql'): Repos => ({
	kind,
	bookmarks: null,
	history: null,
	recent: null,
	favorite: null,
	userConfig: null,
	navigationHiding: null,
	userGroups: null,
	centralColumns: null,
	tracking: null,
	designerPages: null,
	designerSettings: null,
	relation: null,
	tableInfo: null,
	columnInfo: null,
	savedSearches: null,
	tableUiPrefs: null,
	exportTemplates: null
});

/** MySQL repositories on a runner (each one only when its table(s) are configured). */
export function mysqlRepos(server: StorageServer, run: Run): Repos {
	const q = (key: StorageKey) => {
		const name = server[key];
		return server.pmadb && name ? escapeQualified(server.pmadb, name) : null;
	};
	const r = noRepos('mysql');
	const set = <K extends RepoKey>(
		key: K,
		table: StorageKey,
		make: (qualified: string) => Repos[K]
	) => {
		const qualified = q(table);
		if (qualified) r[key] = make(qualified);
	};
	set('bookmarks', 'bookmarktable', (t) => bookmarkRepo(run, t));
	set('history', 'history', (t) => historyRepo(run, t));
	set('recent', 'recent', (t) => recentFavoriteRepo(run, t));
	set('favorite', 'favorite', (t) => recentFavoriteRepo(run, t));
	set('userConfig', 'userconfig', (t) => userConfigRepo(run, t));
	set('navigationHiding', 'navigationhiding', (t) => navigationHidingRepo(run, t));
	set('centralColumns', 'central_columns', (t) => centralColumnsRepo(run, t));
	set('tracking', 'tracking', (t) => trackingRepo(run, t));
	set('designerSettings', 'designer_settings', (t) => designerSettingsRepo(run, t));
	set('relation', 'relation', (t) => relationRepo(run, t));
	set('tableInfo', 'table_info', (t) => tableInfoRepo(run, t));
	set('columnInfo', 'column_info', (t) => columnInfoRepo(run, t));
	set('savedSearches', 'savedsearches', (t) => savedSearchesRepo(run, t));
	set('tableUiPrefs', 'table_uiprefs', (t) => tableUiPrefsRepo(run, t));
	set('exportTemplates', 'export_templates', (t) => exportTemplatesRepo(run, t));
	// features that need two tables
	const users = q('users');
	const groups = q('usergroups');
	if (users && groups) r.userGroups = userGroupsRepo(run, { users, groups });
	const pages = q('pdf_pages');
	const coords = q('table_coords');
	if (pages && coords) r.designerPages = designerPagesRepo(run, { pages, coords });
	return r;
}

let warned = false;

/** The repositories of `server`. `own` yields the user's connection (used without a control user). */
export function storageRepos(server: StorageServer, own: () => Promise<Connection>): Repos {
	switch (storageKind(server)) {
		case 'mysql':
			return mysqlRepos(server, controlRunner(server, own));
		case 'sqlite':
			try {
				return sqliteRepos(
					new SqliteStore(
						openSqlite(server.sqlite_storage!),
						storageServerId(server as ServerConfig)
					)
				);
			} catch (e) {
				if (!warned) {
					warned = true;
					console.error(`[storage] cannot open the SQLite storage ${server.sqlite_storage}:`, e);
				}
				return noRepos('sqlite');
			}
		default:
			return noRepos();
	}
}

/** Repositories of the active server of a request. */
export const reposOf = (locals: App.Locals): Repos => storageRepos(locals.server, () => locals.db);

/**
 * Run `fn` with one repository of the active server. `undefined` when the feature is not
 * configured or the storage fails (callers fall back, like the old `withStorageTable`).
 */
export async function withRepo<K extends RepoKey, T>(
	locals: App.Locals,
	key: K,
	fn: (repo: NonNullable<Repos[K]>) => Promise<T>
): Promise<T | undefined> {
	const repo = reposOf(locals)[key];
	if (!repo) return undefined;
	return attempt(() => fn(repo as NonNullable<Repos[K]>));
}

/** `undefined` instead of an exception. */
export async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
	try {
		return await fn();
	} catch {
		return undefined;
	}
}

/** Is `key` available (configured) for this server? Sync, no I/O. */
export function hasRepo(server: StorageServer, key: RepoKey): boolean {
	return storageRepos(server, () => Promise.reject(new Error('no connection')))[key] !== null;
}
