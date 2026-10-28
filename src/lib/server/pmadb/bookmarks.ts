/** Bookmarks in `pma__bookmark` (libraries/classes/Bookmark.php). `user = ''` means shared. */
import type { Connection } from 'mysql2/promise';
import { escapeString } from '#lib/server/db/escape.ts';
import { applyVariables } from '#lib/sql/bookmark.ts';
import { withStorageTable } from './index.ts';

export interface Bookmark {
	id: number;
	db: string;
	label: string;
	query: string;
	/** Visible to every user. */
	shared: boolean;
}

const toBookmark = (r: Record<string, unknown>): Bookmark => ({
	id: Number(r.id),
	db: String(r.dbase ?? ''),
	label: String(r.label ?? ''),
	query: String(r.query ?? ''),
	shared: String(r.user ?? '') === ''
});

/** Own and shared bookmarks of `db` ('' = server level), by label. */
export async function listBookmarkRows(
	conn: Connection,
	qualified: string,
	user: string,
	db: string
): Promise<Bookmark[]> {
	const [rows] = await conn.query(
		`SELECT * FROM ${qualified} WHERE (\`user\` = '' OR \`user\` = ?) AND \`dbase\` = ? ORDER BY \`label\` ASC`,
		[user, db]
	);
	return (rows as Record<string, unknown>[]).map(toBookmark);
}

/** One bookmark visible to `user` (own or shared). */
export async function getBookmarkRow(
	conn: Connection,
	qualified: string,
	user: string,
	db: string,
	id: number
): Promise<Bookmark | null> {
	const [rows] = await conn.query(
		`SELECT * FROM ${qualified} WHERE \`id\` = ? AND \`dbase\` = ? AND (\`user\` = ? OR \`user\` = '') LIMIT 1`,
		[id, db, user]
	);
	const row = (rows as Record<string, unknown>[])[0];
	return row ? toBookmark(row) : null;
}

export interface NewBookmark {
	db: string;
	label: string;
	query: string;
	shared: boolean;
	/** Delete the visible bookmarks of the same label first (Sql::storeTheQueryAsBookmark). */
	replace: boolean;
}

export async function insertBookmarkRow(
	conn: Connection,
	qualified: string,
	user: string,
	b: NewBookmark
): Promise<number> {
	if (b.replace) {
		// Own and shared bookmarks of the same label are replaced, like in phpMyAdmin.
		const same = (await listBookmarkRows(conn, qualified, user, b.db)).filter(
			(x) => x.label === b.label
		);
		for (const x of same) {
			await conn.query(`DELETE FROM ${qualified} WHERE \`id\` = ?`, [x.id]);
		}
	}
	const [res] = await conn.query(
		`INSERT INTO ${qualified} (\`dbase\`, \`user\`, \`query\`, \`label\`) VALUES (?, ?, ?, ?)`,
		[b.db, b.shared ? '' : user, b.query, b.label]
	);
	return Number((res as { insertId: number }).insertId);
}

export async function deleteBookmarkRow(
	conn: Connection,
	qualified: string,
	user: string,
	id: number
): Promise<boolean> {
	const [res] = await conn.query(
		`DELETE FROM ${qualified} WHERE \`id\` = ? AND (\`user\` = ? OR \`user\` = '')`,
		[id, user]
	);
	return (res as { affectedRows: number }).affectedRows > 0;
}

// ---- entry points ------------------------------------------------------------------------------

const userOf = (locals: App.Locals) => locals.session?.user ?? '';

/** undefined = bookmark storage not available. */
export const listBookmarks = (locals: App.Locals, db: string) =>
	withStorageTable(locals, 'bookmarktable', (conn, q) =>
		listBookmarkRows(conn, q, userOf(locals), db)
	);

export const createBookmark = (locals: App.Locals, b: NewBookmark) =>
	withStorageTable(locals, 'bookmarktable', (conn, q) =>
		insertBookmarkRow(conn, q, userOf(locals), b)
	);

export const removeBookmark = (locals: App.Locals, id: number) =>
	withStorageTable(locals, 'bookmarktable', (conn, q) =>
		deleteBookmarkRow(conn, q, userOf(locals), id)
	);

/** The bookmark's query with its `[VARIABLEn]` placeholders replaced; null when not found. */
export async function bookmarkQuery(
	locals: App.Locals,
	db: string,
	id: number,
	variables: string[]
): Promise<string | null | undefined> {
	return withStorageTable(locals, 'bookmarktable', async (conn, q) => {
		const b = await getBookmarkRow(conn, q, userOf(locals), db, id);
		return b ? applyVariables(b.query, variables, escapeString) : null;
	});
}
