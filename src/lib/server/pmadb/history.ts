/**
 * Query history (Relation::setHistory / getHistory / purgeHistory).
 *
 * Every executed user statement goes into a capped in-memory list per login (phpMyAdmin keeps it in
 * `$_SESSION['sql_history']`). With `QueryHistoryDB` and the `history` table it is also written to
 * `pma__history`, which is then the source of the list.
 */
import type { Connection } from 'mysql2/promise';
import { withStorageTable } from './index.ts';
import { pushHistory, shouldRecord, type HistoryEntry } from '#lib/sql/history.ts';

export type { HistoryEntry };

const MAX_LOGINS = 500;
const memory = new Map<string, HistoryEntry[]>();

const memoryKey = (locals: App.Locals) =>
	`${locals.serverIndex}\n${locals.session?.user ?? ''}\n${locals.session?.host ?? ''}:${locals.session?.port ?? 0}`;

function nowText(): string {
	return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// ---- storage (pma__history) --------------------------------------------------------------------

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

// ---- entry points ------------------------------------------------------------------------------

/** Record executed statements (oldest first). Never throws. */
export async function recordHistory(
	locals: App.Locals,
	entries: { db: string; table: string; sqlquery: string }[]
): Promise<void> {
	try {
		const config = locals.config;
		const max = config.QueryHistoryMax;
		// Only the newest `max` entries can survive the purge anyway.
		const keep = entries
			.filter((e) => shouldRecord(e.sqlquery, config.MaxCharactersInDisplayedSQL))
			.map((e) => ({ ...e, sqlquery: e.sqlquery.trim() }))
			.slice(-Math.max(1, max));
		if (keep.length === 0) return;

		const key = memoryKey(locals);
		let list = memory.get(key) ?? [];
		for (const e of keep) list = pushHistory(list, { ...e, timevalue: nowText() }, max);
		memory.delete(key);
		memory.set(key, list);
		if (memory.size > MAX_LOGINS) memory.delete(memory.keys().next().value as string);

		if (!config.QueryHistoryDB) return;
		const user = locals.session?.user ?? '';
		await withStorageTable(locals, 'history', async (conn, qualified) => {
			for (const e of keep) {
				await insertHistoryRow(conn, qualified, { username: user, ...e });
			}
			await purgeHistoryRows(conn, qualified, user, max);
		});
	} catch {
		// history must never break running a query
	}
}

/** Newest first. */
export async function getHistory(locals: App.Locals): Promise<HistoryEntry[]> {
	const config = locals.config;
	if (config.QueryHistoryDB) {
		const user = locals.session?.user ?? '';
		const stored = await withStorageTable(locals, 'history', (conn, qualified) =>
			selectHistoryRows(conn, qualified, user, config.QueryHistoryMax)
		);
		if (stored) return stored;
	}
	return [...(memory.get(memoryKey(locals)) ?? [])].reverse();
}

export async function clearHistory(locals: App.Locals): Promise<void> {
	memory.delete(memoryKey(locals));
	if (!locals.config.QueryHistoryDB) return;
	const user = locals.session?.user ?? '';
	await withStorageTable(locals, 'history', (conn, qualified) =>
		clearHistoryRows(conn, qualified, user)
	);
}
