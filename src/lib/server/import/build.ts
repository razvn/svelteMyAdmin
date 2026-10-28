/**
 * Creating databases / tables from parsed data (Import::buildSql): `CREATE DATABASE IF NOT EXISTS`,
 * the additional structure statements, `CREATE TABLE IF NOT EXISTS` with analysed column types, and
 * batched INSERTs.
 */
import { escapeId, escapeString } from '#lib/server/db/escape.ts';
import { analyzeTable, columnType, type Cell } from './analyze.ts';
import type { ImportRun } from './run.ts';

export interface TableData {
	name: string;
	colNames: string[];
	rows: Cell[][];
}

export interface BuildOptions {
	createDb: boolean;
	charset?: string | null;
	collation?: string | null;
	/** Guess column types and create the tables (otherwise they must exist or come from `extraSql`). */
	analyze: boolean;
	/** Statements run after the database exists (structure of an XML export). Run with `USE db` first. */
	extraSql?: string[];
}

const MAX_BATCH_ROWS = 500;
const MAX_BATCH_BYTES = 1_000_000;
const IDENT_MAX = 64;
const WORD = /^[A-Za-z0-9_]+$/;

/** Column names MySQL accepts: non-empty, at most 64 characters, unique, no trailing space. */
export function sanitizeColumnNames(names: readonly string[]): string[] {
	const used = new Set<string>();
	return names.map((raw, i) => {
		let name = raw.replace(/\s+$/, '').slice(0, IDENT_MAX);
		if (name === '') name = `COL ${i + 1}`;
		let candidate = name;
		for (let n = 2; used.has(candidate.toLowerCase()); n++) {
			const suffix = `_${n}`;
			candidate = name.slice(0, IDENT_MAX - suffix.length) + suffix;
		}
		used.add(candidate.toLowerCase());
		return candidate;
	});
}

export const tableName = (name: string): string =>
	name.replace(/\s+$/, '').slice(0, IDENT_MAX) || 'TABLE';

const lit = (v: Cell): string => (v === null ? 'NULL' : `'${escapeString(v)}'`);

/** Run an INSERT per batch of rows; false when a statement failed. */
export async function insertRows(
	run: ImportRun,
	target: string,
	cols: string[],
	rows: Cell[][]
): Promise<boolean> {
	if (rows.length === 0) return true;
	const head = `INSERT INTO ${target} (${cols.map(escapeId).join(', ')}) VALUES `;
	let parts: string[] = [];
	let bytes = 0;
	const flush = async () => {
		if (parts.length === 0) return true;
		const n = parts.length;
		const sql = head + parts.join(',\n ');
		parts = [];
		bytes = 0;
		return run.exec(sql, null, n);
	};
	for (const row of rows) {
		const cells = cols.map((_, i) => lit(row[i] ?? null));
		const tuple = `(${cells.join(', ')})`;
		parts.push(tuple);
		bytes += tuple.length;
		if (parts.length >= MAX_BATCH_ROWS || bytes >= MAX_BATCH_BYTES) {
			if (!(await flush())) return false;
		}
	}
	return flush();
}

export async function buildTables(
	run: ImportRun,
	db: string,
	tables: TableData[],
	o: BuildOptions
): Promise<void> {
	if (o.createDb) {
		const cs = o.charset && WORD.test(o.charset) ? o.charset : 'utf8mb4';
		const co = o.collation && WORD.test(o.collation) ? o.collation : null;
		const sql = `CREATE DATABASE IF NOT EXISTS ${escapeId(db)} DEFAULT CHARACTER SET ${cs}${co ? ` COLLATE ${co}` : cs === 'utf8mb4' ? ' COLLATE utf8mb4_general_ci' : ''}`;
		if (!(await run.exec(sql, null))) return;
		run.noteCreated(db);
	}

	if (o.extraSql && o.extraSql.length > 0) {
		if (!(await run.exec(`USE ${escapeId(db)}`, null))) return;
		for (const raw of o.extraSql) {
			const sql = raw.replace(/CREATE [^`]*(TABLE)/, 'CREATE $1 IF NOT EXISTS');
			if (!(await run.exec(sql, null))) return;
			const m = /^\s*CREATE\s[^`]*?(?:TABLE|VIEW)\s+(?:IF NOT EXISTS\s+)?`((?:[^`]|``)+)`/is.exec(
				sql
			);
			if (m) run.noteCreated(db, m[1].replaceAll('``', '`'));
		}
	}

	for (const t of tables) {
		const name = tableName(t.name);
		const cols = sanitizeColumnNames(t.colNames);
		if (cols.length === 0) continue;
		const target = `${escapeId(db)}.${escapeId(name)}`;
		if (o.analyze) {
			const a = analyzeTable(cols, t.rows);
			const defs = cols.map((c, i) => `${escapeId(c)} ${columnType(a.types[i], a.sizes[i])}`);
			if (!(await run.exec(`CREATE TABLE IF NOT EXISTS ${target} (${defs.join(', ')})`, null))) {
				return;
			}
			run.noteCreated(db, name);
		}
		if (!(await insertRows(run, target, cols, t.rows))) return;
		run.noteCreated(db, name);
	}
}
