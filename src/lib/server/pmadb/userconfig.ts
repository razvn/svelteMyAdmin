/**
 * User preferences (UserPreferences::load / save): one row per username with the flat JSON
 * `config_data`, in `pma__userconfig` (MySQL) or the SQLite storage.
 */
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { withRepo } from '#lib/server/storage/index.ts';
import type { StoredPrefs, UserConfigRepo } from '#lib/server/storage/types.ts';

export type { StoredPrefs };
export {
	deleteUserConfig,
	loadUserConfig,
	saveUserConfig
} from '#lib/server/storage/mysql/userconfig.ts';

/** Qualified MySQL table name; null when the user preferences feature is not configured there. */
export function userConfigTable(server: Pick<ServerConfig, 'pmadb' | 'userconfig'>): string | null {
	if (!server.pmadb || !server.userconfig) return null;
	return escapeQualified(server.pmadb, server.userconfig);
}

/** Run `fn` on the user preference repository; undefined when unavailable. */
export function withUserConfig<T>(
	locals: App.Locals,
	fn: (repo: UserConfigRepo) => Promise<T>
): Promise<T | undefined> {
	return withRepo(locals, 'userConfig', fn);
}
