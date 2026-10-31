/** MySQL `pma__history`. */
import type { Connection } from 'mysql2/promise';
import type { HistoryEntry, HistoryRepo } from '../types.ts';
import { pinger, type Run } from './runner.ts';

export async function insertHistoryRow(
	conn: Connection,
	qualified: string,
	row: { username: string; db: string; table: string; sqlquery: string }
): Promise<void> {
	await conn.query(
		`INSERT INTO ${qualified} (\`username\`, \`db\`, \`table\`, \`timevalue\`, \`sqlquery\`) VALUES (?, ?, ?, NOW(), ?)`,
		[row.username, row.db.slice(0, 64), row.table.slice(0, 64), row.sqlquery]
	);
}

/**
 * Keep the newest `max` rows of `username` (by id). phpMyAdmin cuts by `timevalue`, which is only
 * second-precise and would delete every row of the same second; the id is strictly monotonic.
 */
export async function purgeHistoryRows(
	conn: Connection,
	qualified: string,
	username: string,
	max: number
): Promise<number> {
	const limit = Math.max(1, Math.floor(max));
	const [found] = await conn.query(
		`SELECT \`id\` FROM ${qualified} WHERE \`username\` = ? ORDER BY \`id\` DESC LIMIT 1 OFFSET ${limit}`,
		[username]
	);
	const cutoff = (found as { id: number | string }[])[0]?.id;
	if (cutoff === undefined) return 0;
	const [res] = await conn.query(
		`DELETE FROM ${qualified} WHERE \`username\` = ? AND \`id\` <= ?`,
		[username, cutoff]
	);
	return (res as { affectedRows: number }).affectedRows;
}

export async function selectHistoryRows(
	conn: Connection,
	qualified: string,
	username: string,
	limit: number
): Promise<HistoryEntry[]> {
	const [rows] = await conn.query(
		`SELECT \`db\`, \`table\`, \`sqlquery\`, DATE_FORMAT(\`timevalue\`, '%Y-%m-%d %H:%i:%s') AS timevalue ` +
			`FROM ${qualified} WHERE \`username\` = ? ORDER BY \`id\` DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
		[username]
	);
	return (rows as Record<string, unknown>[]).map((r) => ({
		db: String(r.db ?? ''),
		table: String(r.table ?? ''),
		sqlquery: String(r.sqlquery ?? ''),
		timevalue: String(r.timevalue ?? '')
	}));
}

export async function clearHistoryRows(
	conn: Connection,
	qualified: string,
	username: string
): Promise<void> {
	await conn.query(`DELETE FROM ${qualified} WHERE \`username\` = ?`, [username]);
}

export const historyRepo = (run: Run, q: string): HistoryRepo => ({
	ping: pinger(run, q),
	insert: (row) => run((c) => insertHistoryRow(c, q, row)),
	purge: (username, max) => run((c) => purgeHistoryRows(c, q, username, max)),
	select: (username, limit) => run((c) => selectHistoryRows(c, q, username, limit)),
	clear: (username) => run((c) => clearHistoryRows(c, q, username))
});
