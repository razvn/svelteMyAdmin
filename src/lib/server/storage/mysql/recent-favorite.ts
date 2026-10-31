/** MySQL `pma__recent` / `pma__favorite`: one JSON row per user. */
import type { Connection } from 'mysql2/promise';
import { parseTables, serializeTables, type TableRef } from '#lib/nav/recent.ts';
import type { RecentFavoriteRepo } from '../types.ts';
import { pinger, type Run } from './runner.ts';

export async function selectTablesRow(
	conn: Connection,
	qualified: string,
	user: string
): Promise<TableRef[]> {
	const [rows] = await conn.query(`SELECT \`tables\` FROM ${qualified} WHERE \`username\` = ?`, [
		user
	]);
	return parseTables((rows as { tables?: unknown }[])[0]?.tables);
}

export async function replaceTablesRow(
	conn: Connection,
	qualified: string,
	user: string,
	list: readonly TableRef[]
): Promise<void> {
	await conn.query(`REPLACE INTO ${qualified} (\`username\`, \`tables\`) VALUES (?, ?)`, [
		user,
		serializeTables(list)
	]);
}

export const recentFavoriteRepo = (run: Run, q: string): RecentFavoriteRepo => ({
	ping: pinger(run, q),
	select: (user) => run((c) => selectTablesRow(c, q, user)),
	replace: (user, list) => run((c) => replaceTablesRow(c, q, user, list))
});
