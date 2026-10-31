/** MySQL `pma__bookmark`. `user = ''` means shared. */
import type { Connection } from 'mysql2/promise';
import type { Bookmark, BookmarkRepo, NewBookmark } from '../types.ts';
import { pinger, type Run } from './runner.ts';

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

export const bookmarkRepo = (run: Run, q: string): BookmarkRepo => ({
	ping: pinger(run, q),
	list: (user, db) => run((c) => listBookmarkRows(c, q, user, db)),
	get: (user, db, id) => run((c) => getBookmarkRow(c, q, user, db, id)),
	insert: (user, b) => run((c) => insertBookmarkRow(c, q, user, b)),
	delete: (user, id) => run((c) => deleteBookmarkRow(c, q, user, id))
});
