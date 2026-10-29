/**
 * Configuration storage (`pmadb`) access: one place that knows how to reach the `pma__*` tables.
 * Every feature is detected per table (config key set + pmadb set); callers fall back when
 * `withStorageTable` returns undefined (not configured or unreachable).
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { withControl } from '#lib/server/table/control.ts';

export { withControl };

/** Table keys of the server config that name a `pma__*` table. */
export type StorageKey =
	| 'bookmarktable'
	| 'history'
	| 'table_uiprefs'
	| 'savedsearches'
	| 'export_templates'
	| 'tracking'
	| 'central_columns';

/** Qualified, escaped name of a storage table; null when the feature is not configured. */
export function storageTable(
	server: Pick<ServerConfig, 'pmadb'> & Partial<Record<StorageKey, string>>,
	key: StorageKey
): string | null {
	const table = server[key];
	if (!server.pmadb || !table) return null;
	return escapeQualified(server.pmadb, table);
}

/** Run `fn` on the control connection with the qualified table; undefined when unavailable. */
export async function withStorageTable<T>(
	locals: App.Locals,
	key: StorageKey,
	fn: (conn: Connection, qualified: string) => Promise<T>
): Promise<T | undefined> {
	const qualified = storageTable(locals.server, key);
	if (!qualified) return undefined;
	return withControl(locals, (conn) => fn(conn, qualified));
}
