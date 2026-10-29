/**
 * Designer persistence in the configuration storage (Database/Designer/Common.php): pages in
 * `pma__pdf_pages`, table positions in `pma__table_coords`, per-user settings in
 * `pma__designer_settings`. Functions take a connection and qualified table names so tests can run
 * them on any connection.
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { storageTable } from '#lib/server/pmadb/index.ts';
import { withControl } from '#lib/server/table/control.ts';
import type { DesignerPage, Positions } from '#lib/designer/types.ts';
import {
	mergeSetting,
	parseSettings,
	type DesignerKey,
	type StoredSettings
} from '#lib/designer/settings.ts';

export interface DesignerTables {
	pages: string;
	coords: string;
}

/** Pages + coordinates need both tables (phpMyAdmin's `pdfFeature`). */
export function designerTables(server: Pick<ServerConfig, 'pmadb' | 'pdf_pages' | 'table_coords'>) {
	const pages = storageTable(server, 'pdf_pages');
	const coords = storageTable(server, 'table_coords');
	return pages && coords ? ({ pages, coords } satisfies DesignerTables) : null;
}

export async function listPages(
	conn: Connection,
	t: DesignerTables,
	db: string
): Promise<DesignerPage[]> {
	const [rows] = await conn.query(
		`SELECT page_nr, page_descr FROM ${t.pages} WHERE db_name = ? ORDER BY page_descr, page_nr`,
		[db]
	);
	return (rows as { page_nr: number; page_descr: string }[]).map((r) => ({
		id: Number(r.page_nr),
		name: String(r.page_descr)
	}));
}

export async function pageExists(
	conn: Connection,
	t: DesignerTables,
	db: string,
	id: number
): Promise<boolean> {
	const [rows] = await conn.query(`SELECT 1 FROM ${t.pages} WHERE db_name = ? AND page_nr = ?`, [
		db,
		id
	]);
	return (rows as unknown[]).length > 0;
}

export async function createPage(
	conn: Connection,
	t: DesignerTables,
	db: string,
	name: string
): Promise<number> {
	const [res] = await conn.query(`INSERT INTO ${t.pages} (db_name, page_descr) VALUES (?, ?)`, [
		db,
		name
	]);
	return Number((res as { insertId: number }).insertId);
}

export async function renamePage(
	conn: Connection,
	t: DesignerTables,
	db: string,
	id: number,
	name: string
): Promise<void> {
	await conn.query(`UPDATE ${t.pages} SET page_descr = ? WHERE db_name = ? AND page_nr = ?`, [
		name,
		db,
		id
	]);
}

/** Delete a page and its coordinates (Common::deletePage). */
export async function deletePage(
	conn: Connection,
	t: DesignerTables,
	db: string,
	id: number
): Promise<void> {
	await conn.query(`DELETE FROM ${t.coords} WHERE db_name = ? AND pdf_page_number = ?`, [db, id]);
	await conn.query(`DELETE FROM ${t.pages} WHERE db_name = ? AND page_nr = ?`, [db, id]);
}

export async function loadPositions(
	conn: Connection,
	t: DesignerTables,
	db: string,
	id: number
): Promise<Positions> {
	const [rows] = await conn.query(
		`SELECT table_name, x, y FROM ${t.coords} WHERE db_name = ? AND pdf_page_number = ?`,
		[db, id]
	);
	const out: Positions = {};
	for (const r of rows as { table_name: string; x: number; y: number }[]) {
		out[String(r.table_name)] = { x: Number(r.x), y: Number(r.y) };
	}
	return out;
}

/** Replace the coordinates of a page (Common::saveTablePositions deletes, then inserts). */
export async function savePositions(
	conn: Connection,
	t: DesignerTables,
	db: string,
	id: number,
	positions: Positions
): Promise<void> {
	await conn.query(`DELETE FROM ${t.coords} WHERE db_name = ? AND pdf_page_number = ?`, [db, id]);
	for (const [table, p] of Object.entries(positions)) {
		// the columns are `float unsigned`: never negative
		await conn.query(
			`INSERT INTO ${t.coords} (db_name, table_name, pdf_page_number, x, y) VALUES (?, ?, ?, ?, ?)`,
			[db, table, id, Math.max(0, p.x), Math.max(0, p.y)]
		);
	}
}

export async function loadSettingsJson(
	conn: Connection,
	qualified: string,
	username: string
): Promise<string | null> {
	const [rows] = await conn.query(`SELECT settings_data FROM ${qualified} WHERE username = ?`, [
		username
	]);
	const row = (rows as { settings_data: string }[])[0];
	return row ? String(row.settings_data) : null;
}

export async function loadSettings(
	conn: Connection,
	qualified: string,
	username: string
): Promise<StoredSettings> {
	return parseSettings(await loadSettingsJson(conn, qualified, username));
}

/** Set one setting, keeping the user's other keys (Common::saveSetting). */
export async function saveSetting(
	conn: Connection,
	qualified: string,
	username: string,
	key: DesignerKey,
	value: string
): Promise<void> {
	const current = await loadSettingsJson(conn, qualified, username);
	const json = mergeSetting(current, key, value);
	if (current === null) {
		await conn.query(`INSERT INTO ${qualified} (username, settings_data) VALUES (?, ?)`, [
			username,
			json
		]);
	} else {
		await conn.query(`UPDATE ${qualified} SET settings_data = ? WHERE username = ?`, [
			json,
			username
		]);
	}
}

export function settingsTable(
	server: Pick<ServerConfig, 'pmadb' | 'designer_settings'>
): string | null {
	return storageTable(server, 'designer_settings');
}

/** Run with the pages + coordinates tables on the control connection; undefined when unavailable. */
export async function withDesignerTables<T>(
	locals: App.Locals,
	fn: (conn: Connection, t: DesignerTables) => Promise<T>
): Promise<T | undefined> {
	const t = designerTables(locals.server);
	if (!t) return undefined;
	return withControl(locals, (conn) => fn(conn, t));
}
