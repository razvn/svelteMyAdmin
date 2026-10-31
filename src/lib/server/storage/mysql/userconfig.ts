/** MySQL `pma__userconfig`: one row per username with the flat JSON `config_data`. */
import type { Connection } from 'mysql2/promise';
import { parseConfigData, type PrefData } from '#lib/preferences/logic.ts';
import type { StoredPrefs, UserConfigRepo } from '../types.ts';
import { pinger, type Run } from './runner.ts';

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

export const userConfigRepo = (run: Run, q: string): UserConfigRepo => ({
	ping: pinger(run, q),
	load: (username) => run((c) => loadUserConfig(c, q, username)),
	save: (username, data) => run((c) => saveUserConfig(c, q, username, data)),
	delete: (username) => run((c) => deleteUserConfig(c, q, username))
});
