/**
 * Recent and favorite tables. Persistent in `pma__recent` / `pma__favorite` (read and written with the
 * control connection, JSON like phpMyAdmin) and kept in server memory per login otherwise, which is
 * the equivalent of phpMyAdmin's session fallback.
 */
import type { Connection } from 'mysql2/promise';
import {
	addTable,
	hasTable,
	parseTables,
	removeTable,
	serializeTables,
	type ListKind,
	type TableRef
} from '#lib/nav/recent.ts';
import { withStorageTable } from './index.ts';

export type { ListKind, TableRef };

const MAX_LOGINS = 500;
const memory = new Map<string, TableRef[]>();

const memoryKey = (locals: App.Locals, kind: ListKind) =>
	`${kind}\n${locals.serverIndex}\n${locals.session?.user ?? ''}\n${locals.session?.host ?? ''}:${locals.session?.port ?? 0}`;

const username = (locals: App.Locals) => locals.session?.user ?? '';

const maxFor = (locals: App.Locals, kind: ListKind) =>
	Math.max(0, kind === 'recent' ? locals.config.NumRecentTables : locals.config.NumFavoriteTables);

// ---- storage -----------------------------------------------------------------------------------

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

// ---- entry points ------------------------------------------------------------------------------

/** Newest first. `persistent` tells whether the list lives in the configuration storage. */
export async function getTableList(
	locals: App.Locals,
	kind: ListKind
): Promise<{ tables: TableRef[]; persistent: boolean }> {
	const stored = await withStorageTable(locals, kind, (conn, q) =>
		selectTablesRow(conn, q, username(locals))
	);
	if (stored) return { tables: stored, persistent: true };
	return { tables: [...(memory.get(memoryKey(locals, kind)) ?? [])], persistent: false };
}

async function save(locals: App.Locals, kind: ListKind, list: TableRef[]): Promise<void> {
	const saved = await withStorageTable(locals, kind, async (conn, q) => {
		await replaceTablesRow(conn, q, username(locals), list);
		return true;
	});
	if (saved) return;
	const key = memoryKey(locals, kind);
	memory.delete(key);
	memory.set(key, list);
	if (memory.size > MAX_LOGINS) memory.delete(memory.keys().next().value as string);
}

/** Record a table visit (`RecentFavoriteTable::add('recent')`). Never throws. */
export async function recordRecent(locals: App.Locals, ref: TableRef): Promise<void> {
	try {
		const { tables } = await getTableList(locals, 'recent');
		if (tables.length > 0 && tables[0].db === ref.db && tables[0].table === ref.table) return;
		await save(locals, 'recent', addTable(tables, ref, maxFor(locals, 'recent')));
	} catch {
		// a visit must never break the page
	}
}

export type FavoriteResult = 'added' | 'removed' | 'full';

/** Toggle a favorite; adding is refused when NumFavoriteTables is reached (like phpMyAdmin). */
export async function toggleFavorite(
	locals: App.Locals,
	ref: TableRef,
	want?: boolean
): Promise<FavoriteResult> {
	const { tables } = await getTableList(locals, 'favorite');
	const isFavorite = hasTable(tables, ref);
	const add = want ?? !isFavorite;
	if (!add) {
		if (isFavorite) await save(locals, 'favorite', removeTable(tables, ref));
		return 'removed';
	}
	if (isFavorite) return 'added';
	if (tables.length >= maxFor(locals, 'favorite')) return 'full';
	await save(locals, 'favorite', addTable(tables, ref, maxFor(locals, 'favorite')));
	return 'added';
}
