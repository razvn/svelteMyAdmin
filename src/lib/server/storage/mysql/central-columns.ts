/** MySQL `pma__central_columns` (libraries/classes/Database/CentralColumns.php). */
import type { Connection } from 'mysql2/promise';
import {
	fromRow,
	toRowValues,
	type CentralColumn,
	type CentralRow
} from '#lib/sql/central-columns.ts';
import type { AddResult, CentralColumnsRepo, CentralListOptions } from '../types.ts';
import { pinger, type Run } from './runner.ts';

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

export const centralColumnsRepo = (run: Run, q: string): CentralColumnsRepo => ({
	ping: pinger(run, q),
	list: (db, o) => run((c) => listCentral(c, q, db, o)),
	count: (db, filter) => run((c) => countCentral(c, q, db, filter)),
	add: (db, columns) => run((c) => addCentral(c, q, db, columns)),
	update: (db, original, col) => run((c) => updateCentral(c, q, db, original, col)),
	delete: (db, names) => run((c) => deleteCentral(c, q, db, names))
});
