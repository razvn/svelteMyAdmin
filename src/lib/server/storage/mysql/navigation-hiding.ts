/** MySQL `pma__navigationhiding`. */
import type { Connection } from 'mysql2/promise';
import type { HiddenItem, HiddenType } from '#lib/nav/hidden.ts';
import type { NavigationHidingRepo } from '../types.ts';
import { pinger, type Run } from './runner.ts';

export async function selectHiddenRows(
	conn: Connection,
	qualified: string,
	user: string,
	db: string
): Promise<HiddenItem[]> {
	const [rows] = await conn.query(
		`SELECT \`item_name\`, \`item_type\` FROM ${qualified} WHERE \`username\` = ? AND \`db_name\` = ? ORDER BY \`item_type\`, \`item_name\``,
		[user, db]
	);
	return (rows as Record<string, unknown>[]).map((r) => ({
		name: String(r.item_name),
		type: String(r.item_type) as HiddenType
	}));
}

export async function insertHiddenRow(
	conn: Connection,
	qualified: string,
	user: string,
	db: string,
	item: HiddenItem
): Promise<void> {
	await conn.query(
		`INSERT IGNORE INTO ${qualified} (\`username\`, \`item_name\`, \`item_type\`, \`db_name\`, \`table_name\`) VALUES (?, ?, ?, ?, '')`,
		[user, item.name, item.type, db]
	);
}

export async function deleteHiddenRow(
	conn: Connection,
	qualified: string,
	user: string,
	db: string,
	item: HiddenItem
): Promise<void> {
	await conn.query(
		`DELETE FROM ${qualified} WHERE \`username\` = ? AND \`item_name\` = ? AND \`item_type\` = ? AND \`db_name\` = ?`,
		[user, item.name, item.type, db]
	);
}

export const navigationHidingRepo = (run: Run, q: string): NavigationHidingRepo => ({
	ping: pinger(run, q),
	list: (user, db) => run((c) => selectHiddenRows(c, q, user, db)),
	hide: (user, db, item) => run((c) => insertHiddenRow(c, q, user, db, item)),
	unhide: (user, db, item) => run((c) => deleteHiddenRow(c, q, user, db, item))
});
