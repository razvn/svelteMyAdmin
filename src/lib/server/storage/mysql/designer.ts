/** MySQL `pma__pdf_pages`, `pma__table_coords` and `pma__designer_settings` (Designer/Common.php). */
import type { Connection } from 'mysql2/promise';
import type { DesignerPage, Positions } from '#lib/designer/types.ts';
import type { DesignerPagesRepo, DesignerSettingsRepo } from '../types.ts';
import { pinger, type Run } from './runner.ts';

export interface DesignerTables {
	pages: string;
	coords: string;
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

/** INSERT or UPDATE the settings row of a user. */
export async function storeSettingsJson(
	conn: Connection,
	qualified: string,
	username: string,
	json: string
): Promise<void> {
	const current = await loadSettingsJson(conn, qualified, username);
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

export const designerPagesRepo = (run: Run, t: DesignerTables): DesignerPagesRepo => ({
	async ping() {
		return (await pinger(run, t.pages)()) && (await pinger(run, t.coords)());
	},
	listPages: (db) => run((c) => listPages(c, t, db)),
	pageExists: (db, id) => run((c) => pageExists(c, t, db, id)),
	createPage: (db, name) => run((c) => createPage(c, t, db, name)),
	renamePage: (db, id, name) => run((c) => renamePage(c, t, db, id, name)),
	deletePage: (db, id) => run((c) => deletePage(c, t, db, id)),
	loadPositions: (db, id) => run((c) => loadPositions(c, t, db, id)),
	savePositions: (db, id, positions) => run((c) => savePositions(c, t, db, id, positions))
});

export const designerSettingsRepo = (run: Run, q: string): DesignerSettingsRepo => ({
	ping: pinger(run, q),
	get: (username) => run((c) => loadSettingsJson(c, q, username)),
	set: (username, json) => run((c) => storeSettingsJson(c, q, username, json))
});
