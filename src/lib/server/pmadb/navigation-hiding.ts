/** Hidden navigation items in `pma__navigationhiding` (Navigation.php hide/unhide/getHiddenItems). */
import type { Connection } from 'mysql2/promise';
import type { HiddenItem, HiddenType } from '#lib/nav/hidden.ts';
import { withStorageTable } from './index.ts';

export type { HiddenItem, HiddenType };

const username = (locals: App.Locals) => locals.session?.user ?? '';

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

/** Hidden items of `db`; undefined when the navigationhiding feature is unavailable. */
export function listHiddenItems(locals: App.Locals, db: string) {
	return withStorageTable(locals, 'navigationhiding', (conn, q) =>
		selectHiddenRows(conn, q, username(locals), db)
	);
}

/** True when stored. */
export async function hideItem(locals: App.Locals, db: string, item: HiddenItem): Promise<boolean> {
	return !!(await withStorageTable(locals, 'navigationhiding', async (conn, q) => {
		await insertHiddenRow(conn, q, username(locals), db, item);
		return true;
	}));
}

export async function unhideItem(
	locals: App.Locals,
	db: string,
	item: HiddenItem
): Promise<boolean> {
	return !!(await withStorageTable(locals, 'navigationhiding', async (conn, q) => {
		await deleteHiddenRow(conn, q, username(locals), db, item);
		return true;
	}));
}
