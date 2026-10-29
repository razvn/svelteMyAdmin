/**
 * User preferences in `pma__userconfig` (UserPreferences::load / save): one row per username with the
 * flat JSON `config_data`. Functions take a connection and the qualified table so tests can run them
 * on any connection; `withUserConfig` runs them on the control connection.
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { withControl } from '#lib/server/table/control.ts';
import { parseConfigData, type PrefData } from '#lib/preferences/logic.ts';

/** Qualified table name; null when the user preferences feature is not configured. */
export function userConfigTable(server: Pick<ServerConfig, 'pmadb' | 'userconfig'>): string | null {
	if (!server.pmadb || !server.userconfig) return null;
	return escapeQualified(server.pmadb, server.userconfig);
}

export interface StoredPrefs {
	data: PrefData;
	/** Unix seconds of the last save. */
	mtime: number;
}

export async function loadUserConfig(
	conn: Connection,
	qualified: string,
	username: string
): Promise<StoredPrefs | null> {
	const [rows] = await conn.query(
		`SELECT \`config_data\`, UNIX_TIMESTAMP(\`timevalue\`) AS ts FROM ${qualified} WHERE \`username\` = ?`,
		[username]
	);
	const row = (rows as { config_data: unknown; ts: unknown }[])[0];
	if (!row) return null;
	return { data: parseConfigData(String(row.config_data ?? '')), mtime: Number(row.ts) || 0 };
}

/** UPDATE or INSERT the row (phpMyAdmin selects first, then updates or inserts). */
export async function saveUserConfig(
	conn: Connection,
	qualified: string,
	username: string,
	data: PrefData
): Promise<void> {
	// PHP json_encode()s an empty array as `[]`
	const json = Object.keys(data).length === 0 ? '[]' : JSON.stringify(data);
	const [found] = await conn.query(`SELECT \`username\` FROM ${qualified} WHERE \`username\` = ?`, [
		username
	]);
	if ((found as unknown[]).length > 0) {
		await conn.query(
			`UPDATE ${qualified} SET \`timevalue\` = NOW(), \`config_data\` = ? WHERE \`username\` = ?`,
			[json, username]
		);
	} else {
		await conn.query(
			`INSERT INTO ${qualified} (\`username\`, \`timevalue\`, \`config_data\`) VALUES (?, NOW(), ?)`,
			[username, json]
		);
	}
}

export async function deleteUserConfig(
	conn: Connection,
	qualified: string,
	username: string
): Promise<void> {
	await conn.query(`DELETE FROM ${qualified} WHERE \`username\` = ?`, [username]);
}

/** Run `fn` on the control connection with the qualified table; undefined when unavailable. */
export async function withUserConfig<T>(
	locals: App.Locals,
	fn: (conn: Connection, qualified: string) => Promise<T>
): Promise<T | undefined> {
	const qualified = userConfigTable(locals.server);
	if (!qualified) return undefined;
	return withControl(locals, (conn) => fn(conn, qualified));
}
