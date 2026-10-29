/** Central list of columns in `pma__central_columns` (libraries/classes/Database/CentralColumns.php). */
import type { Connection } from 'mysql2/promise';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import {
	fromRow,
	fromShowColumn,
	toRowValues,
	type CentralColumn,
	type CentralRow
} from '#lib/sql/central-columns.ts';

export interface CentralListOptions {
	pos?: number;
	/** 0 = no limit. */
	num?: number;
	/** Substring of the column name. */
	filter?: string;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export async function listCentral(
	conn: Connection,
	q: string,
	db: string,
	o: CentralListOptions = {}
): Promise<CentralColumn[]> {
	const params: (string | number)[] = [db];
	let where = 'db_name = ?';
	if (o.filter) {
		where += ' AND col_name LIKE ?';
		params.push(`%${likeEscape(o.filter)}%`);
	}
	let limit = '';
	if (o.num) {
		limit = ' LIMIT ?, ?';
		params.push(Math.max(0, Math.trunc(o.pos ?? 0)), Math.trunc(o.num));
	}
	const [rows] = await conn.query(
		`SELECT * FROM ${q} WHERE ${where} ORDER BY col_name${limit}`,
		params
	);
	return (rows as CentralRow[]).map(fromRow);
}

export async function countCentral(
	conn: Connection,
	q: string,
	db: string,
	filter = ''
): Promise<number> {
	const params: string[] = [db];
	let where = 'db_name = ?';
	if (filter) {
		where += ' AND col_name LIKE ?';
		params.push(`%${likeEscape(filter)}%`);
	}
	const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM ${q} WHERE ${where}`, params);
	return Number((rows as { n: number }[])[0]?.n ?? 0);
}

async function existingNames(
	conn: Connection,
	q: string,
	db: string,
	names: string[]
): Promise<Set<string>> {
	if (names.length === 0) return new Set();
	const [rows] = await conn.query(
		`SELECT col_name FROM ${q} WHERE db_name = ? AND col_name IN (?)`,
		[db, names]
	);
	return new Set((rows as { col_name: string }[]).map((r) => r.col_name));
}

export interface AddResult {
	added: string[];
	/** Already in the list: left untouched (phpMyAdmin asks to remove them first). */
	existing: string[];
}

export async function addCentral(
	conn: Connection,
	q: string,
	db: string,
	columns: CentralColumn[]
): Promise<AddResult> {
	const have = await existingNames(
		conn,
		q,
		db,
		columns.map((c) => c.name)
	);
	const result: AddResult = { added: [], existing: [] };
	for (const c of columns) {
		if (have.has(c.name)) {
			if (!result.existing.includes(c.name)) result.existing.push(c.name);
			continue;
		}
		have.add(c.name);
		await conn.query(
			`INSERT INTO ${q} (db_name, col_name, col_type, col_length, col_collation, col_isNull, col_extra, col_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[db, ...toRowValues(c)]
		);
		result.added.push(c.name);
	}
	return result;
}

/** CentralColumns::syncUniqueColumns for columns of one table. */
export async function addTableColumns(
	conn: Connection,
	q: string,
	dbi: DatabaseInterface,
	db: string,
	table: string,
	names: string[]
): Promise<AddResult> {
	const all = await dbi.getColumns(db, table);
	const picked = all.filter((c) => names.includes(c.field)).map(fromShowColumn);
	return addCentral(conn, q, db, picked);
}

export async function updateCentral(
	conn: Connection,
	q: string,
	db: string,
	original: string,
	c: CentralColumn
): Promise<void> {
	const [name, ...rest] = toRowValues(c);
	await conn.query(
		`UPDATE ${q} SET col_name = ?, col_type = ?, col_length = ?, col_collation = ?, col_isNull = ?, col_extra = ?, col_default = ? WHERE db_name = ? AND col_name = ?`,
		[name, ...rest, db, original]
	);
}

/** Returns the names that were not in the list. */
export async function deleteCentral(
	conn: Connection,
	q: string,
	db: string,
	names: string[]
): Promise<string[]> {
	if (names.length === 0) return [];
	const have = await existingNames(conn, q, db, names);
	await conn.query(`DELETE FROM ${q} WHERE db_name = ? AND col_name IN (?)`, [db, names]);
	return names.filter((n) => !have.has(n));
}
