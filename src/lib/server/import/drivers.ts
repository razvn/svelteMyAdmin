/**
 * Import drivers: one per format (Plugins/Import/Import{Sql,Csv,Ldi,Ods,Xml,Mediawiki}.php). A
 * driver reads the decompressed bytes of the upload and runs queries through `ImportRun`.
 */
import { Readable } from 'node:stream';
import type { ImportFormat, ImportOptionValues, ImportScope } from '#lib/import/types.ts';
import { escapeId, escapeString } from '#lib/server/db/escape.ts';
import { StatementSplitter } from '#lib/server/db/splitter.ts';
import { buildTables, insertRows, sanitizeColumnNames, type TableData } from './build.ts';
import { CsvFormatError, CsvParser, unescapeCsvOption, validateCsvOptions } from './formats/csv.ts';
import { MediaWikiError, parseMediaWiki } from './formats/mediawiki.ts';
import { OdsError, parseOds } from './formats/ods.ts';
import { parsePmaXml, XmlFormatError } from './formats/pma-xml.ts';
import type { ImportRun } from './run.ts';
import { collectBytes, collectText, decodeText, ImportAbort } from './source.ts';
import type { Cell } from './analyze.ts';

export interface DriverContext {
	run: ImportRun;
	scope: ImportScope;
	/** Decompressed upload. */
	bytes: AsyncIterable<Uint8Array>;
	/** WHATWG encoding label. */
	charset: string;
	options: ImportOptionValues;
	/** File name without the compression suffix. */
	innerName: string;
	memoryLimit: number;
}

export type Driver = (ctx: DriverContext) => Promise<void>;

const str = (o: ImportOptionValues, k: string, d = ''): string => {
	const v = o[k];
	return typeof v === 'string' ? v : v === undefined ? d : String(v);
};
const bool = (o: ImportOptionValues, k: string): boolean =>
	o[k] === true || o[k] === 'true' || o[k] === 'on' || o[k] === '1';
const num = (o: ImportOptionValues, k: string): number => {
	const n = Number(o[k]);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

// ---- SQL ---------------------------------------------------------------------------------------

const SQL_MODE_NAME = /^[A-Z_]+$/;

export const sqlDriver: Driver = async ({ run, bytes, charset, options }) => {
	const modes: string[] = [];
	const compat = str(options, 'compatibility', 'NONE');
	if (compat !== 'NONE' && SQL_MODE_NAME.test(compat)) modes.push(compat);
	if (bool(options, 'no_auto_value_on_zero')) modes.push('NO_AUTO_VALUE_ON_ZERO');
	if (modes.length > 0) {
		try {
			await run.conn.query(`SET SQL_MODE = '${modes.join(',')}'`);
		} catch {
			/* PHP ignores a failing SET SQL_MODE (tryQuery) */
		}
	}

	const handle = async (sql: string, line: number): Promise<boolean> => {
		if (run.seen >= run.skip && run.checkTime()) return false;
		if (run.takeSkip()) return true;
		return run.exec(sql, line);
	};
	const splitter = new StatementSplitter();
	for await (const text of decodeText(bytes, charset)) {
		for (const st of splitter.push(text)) {
			if (!(await handle(st.sql, st.line))) return;
		}
	}
	for (const st of splitter.end()) {
		if (!(await handle(st.sql, st.line))) return;
	}
};

// ---- CSV ---------------------------------------------------------------------------------------

function csvOptions(o: ImportOptionValues, fallback: { terminated: string; escaped: string }) {
	return {
		terminated: unescapeCsvOption(str(o, 'terminated', fallback.terminated)),
		enclosed: unescapeCsvOption(str(o, 'enclosed', '"')),
		escaped: unescapeCsvOption(str(o, 'escaped', fallback.escaped)),
		newLine: unescapeCsvOption(str(o, 'new_line', 'auto')) || 'auto'
	};
}

async function listColumns(run: ImportRun, db: string, table: string): Promise<string[]> {
	const [rows] = await run.conn.query(
		"SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%' ORDER BY ORDINAL_POSITION",
		[db, table]
	);
	return (rows as { c: string }[]).map((r) => r.c);
}

async function countNames(run: ImportRun, sql: string): Promise<string[]> {
	const [rows] = await run.conn.query(sql);
	return (rows as Record<string, string>[]).map((r) => String(Object.values(r)[0]));
}

/** Table name for a new table from the file name (ImportCsv::getTableNameFromImport). */
export async function newTableName(
	run: ImportRun,
	db: string | null,
	innerName: string,
	requested: string
): Promise<string> {
	if (requested !== '') return requested;
	const base = (
		innerName
			.replace(/\.[^.]*$/, '')
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, '_') || 'table'
	).slice(0, 60);
	if (!db) return base;
	const existing = new Set(
		(await countNames(run, `SHOW TABLES FROM ${escapeId(db)}`)).map((t) => t.toLowerCase())
	);
	if (!existing.has(base)) return base;
	for (let n = 2; ; n++) if (!existing.has(`${base}_${n}`)) return `${base}_${n}`;
}

const columnList = (value: string): string[] =>
	value
		.split(/,\s?/)
		.map((v) =>
			v
				.trim()
				.replace(/^`+|`+$/g, '')
				.trim()
		)
		.filter((v) => v !== '');

async function csvIntoTable(ctx: DriverContext, db: string, table: string): Promise<void> {
	const { run, options } = ctx;
	const o = options;
	const target = `${escapeId(db)}.${escapeId(table)}`;
	const all = await listColumns(run, db, table);
	const requested = columnList(str(o, 'columns'));
	for (const c of requested) {
		if (!all.includes(c)) {
			run.fail(
				`Invalid column (${c}) specified! Ensure that columns names are spelled correctly, separated by commas, and not enclosed in quotes.`
			);
			return;
		}
	}
	let fields = requested.length > 0 ? requested : all;
	const colNamesInFile = bool(o, 'col_names');
	const maxRows = num(o, 'partial_import');
	const ignore = bool(o, 'ignore');
	const replace = bool(o, 'replace');

	if (bool(o, 'truncate') && run.skip === 0) {
		if (!(await run.exec(`TRUNCATE TABLE ${target}`, null, 0))) return;
	}

	let fieldsFromHeader = false;
	const build = () =>
		`INSERT${ignore ? ' IGNORE' : ''} INTO ${target}${requested.length > 0 || fieldsFromHeader ? ` (${fields.map(escapeId).join(', ')})` : ''} VALUES `;
	const suffix = () =>
		replace
			? ` ON DUPLICATE KEY UPDATE ${fields.map((f) => `${escapeId(f)} = VALUES(${escapeId(f)})`).join(', ')}`
			: '';
	const tuple = (values: Cell[]) =>
		`(${values.map((v) => (v === null ? 'NULL' : `'${escapeString(v)}'`)).join(', ')})`;

	let pending: { values: Cell[]; line: number }[] = [];
	const flush = async (): Promise<boolean> => {
		if (pending.length === 0) return true;
		const batch = pending;
		pending = [];
		const baseSeen = run.seen - batch.length;
		const head = build();
		const tail = suffix();
		if (
			await run.exec(
				head + batch.map((r) => tuple(r.values)).join(',\n ') + tail,
				batch[0].line,
				batch.length
			)
		) {
			return true;
		}
		if (batch.length === 1) return false;
		// Pinpoint the failing row: replay the batch row by row (a failed INSERT inserts nothing).
		run.error = null;
		for (let k = 0; k < batch.length; k++) {
			if (!(await run.exec(head + tuple(batch[k].values) + tail, batch[k].line))) {
				run.seen = baseSeen + k + 1;
				return false;
			}
		}
		return true;
	};

	const parser = new CsvParser(csvOptions(o, { terminated: ',', escaped: '"' }));
	let header = colNamesInFile;
	let rowsTaken = 0;
	let done = false;

	const onRows = async (rows: ReturnType<CsvParser['push']>): Promise<boolean> => {
		for (const row of rows) {
			if (header) {
				header = false;
				if (requested.length === 0) {
					const names = row.values.map((v) => (v ?? '').trimEnd());
					if (names.length > 0 && names.every((n) => all.includes(n))) {
						fields = names;
						fieldsFromHeader = true;
					}
				}
				continue;
			}
			if (maxRows > 0 && rowsTaken >= maxRows) {
				done = true;
				break;
			}
			rowsTaken++;
			let values = row.values;
			if (values.length !== fields.length) {
				// Excel hack: a trailing ';' column.
				if (values.length === fields.length + 1 && values[values.length - 1] === ';') {
					values = values.slice(0, -1);
				} else {
					run.seen++;
					run.fail(`Invalid column count in CSV input on line ${row.line}.`, row.line);
					return false;
				}
			}
			if (run.takeSkip()) continue;
			pending.push({ values, line: row.line });
			if (pending.length >= 200) {
				if (!(await flush())) return false;
				if (run.seen >= run.skip && run.checkTime()) return false;
			}
		}
		return true;
	};

	for await (const text of decodeText(ctx.bytes, ctx.charset)) {
		if (!(await onRows(parser.push(text)))) {
			await flush();
			return;
		}
		if (done) break;
	}
	if (!done && !(await onRows(parser.end()))) {
		await flush();
		return;
	}
	await flush();
}

async function csvAnalyze(ctx: DriverContext): Promise<void> {
	const { run, scope, options: o } = ctx;
	const parser = new CsvParser(csvOptions(o, { terminated: ',', escaped: '"' }));
	const text = await collectText(decodeText(ctx.bytes, ctx.charset), ctx.memoryLimit);
	const rows = [...parser.push(text), ...parser.end()].map((r) => r.values);
	const maxRows = num(o, 'partial_import');
	const colNamesInFile = bool(o, 'col_names');
	const limit = maxRows > 0 ? maxRows + (colNamesInFile ? 1 : 0) : rows.length;
	const taken = rows.slice(0, limit);
	const maxCols = taken.reduce((m, r) => Math.max(m, r.length), 0);
	for (const r of taken) while (r.length < maxCols) r.push(null);
	let colNames: string[];
	if (colNamesInFile && taken.length > 0) {
		colNames = taken.shift()!.map((v) => (v ?? '').trimEnd());
	} else {
		colNames = [];
	}
	for (let i = colNames.length; i < maxCols; i++) colNames.push(`COL ${i + 1}`);

	const db = scope.level === 'server' ? null : scope.db;
	const tbl = await newTableName(run, db, ctx.innerName, str(o, 'new_tbl_name'));
	let target = db;
	let createDb = false;
	if (!target) {
		target = str(o, 'new_db_name');
		if (target === '') {
			target = `CSV_DB ${(await countNames(run, 'SHOW DATABASES')).length + 1}`;
		}
		createDb = true;
	}
	await buildTables(run, target, [{ name: tbl, colNames, rows: taken }], {
		createDb,
		analyze: true
	});
}

export const csvDriver: Driver = async (ctx) => {
	const err = validateCsvOptions(csvOptions(ctx.options, { terminated: ',', escaped: '"' }));
	if (err) {
		ctx.run.fail(err);
		return;
	}
	if (ctx.scope.level === 'table') {
		await csvIntoTable(ctx, ctx.scope.db, ctx.scope.table);
	} else {
		await csvAnalyze(ctx);
	}
};

// ---- CSV using LOAD DATA -----------------------------------------------------------------------

/** Is `LOAD DATA LOCAL INFILE` usable on this server (`local_infile` ON)? */
export async function localInfileEnabled(run: Pick<ImportRun, 'conn'>): Promise<boolean> {
	try {
		const [rows] = await run.conn.query('SELECT @@GLOBAL.local_infile AS v');
		const v = String((rows as { v: unknown }[])[0]?.v ?? '');
		return v === '1' || v.toUpperCase() === 'ON';
	} catch {
		return false;
	}
}

export const ldiDriver: Driver = async (ctx) => {
	const { run, scope, options: o } = ctx;
	if (scope.level !== 'table') {
		run.fail('CSV using LOAD DATA is only available for tables.');
		return;
	}
	if (!(await localInfileEnabled(run))) {
		run.fail('LOAD DATA LOCAL INFILE is disabled on this server (local_infile is OFF).');
		return;
	}
	const terminated = unescapeCsvOption(str(o, 'terminated', ';'));
	const enclosed = unescapeCsvOption(str(o, 'enclosed', '"'));
	const escaped = unescapeCsvOption(str(o, 'escaped', '\\'));
	let newLine = str(o, 'new_line', 'auto');
	const q = (s: string) => `'${escapeString(s)}'`;

	let sql = 'LOAD DATA LOCAL INFILE ' + q('upload');
	if (bool(o, 'replace')) sql += ' REPLACE';
	else if (bool(o, 'ignore')) sql += ' IGNORE';
	sql += ` INTO TABLE ${escapeId(scope.db)}.${escapeId(scope.table)} CHARACTER SET utf8mb4`;
	const fields: string[] = [];
	if (terminated !== '') fields.push(`TERMINATED BY ${q(terminated)}`);
	if (enclosed !== '') fields.push(`ENCLOSED BY ${q(enclosed)}`);
	if (escaped !== '') fields.push(`ESCAPED BY ${q(escaped)}`);
	if (fields.length > 0) sql += ' FIELDS ' + fields.join(' ');
	if (newLine !== '') {
		if (newLine === 'auto') newLine = '\n';
		else newLine = unescapeCsvOption(newLine);
		sql += ` LINES TERMINATED BY ${q(newLine)}`;
	}
	if (run.skip > 0) sql += ` IGNORE ${run.skip} LINES`;
	const cols = columnList(str(o, 'columns'));
	if (cols.length > 0) sql += ` (${cols.map(escapeId).join(', ')})`;

	// Re-encode to UTF-8 so the `charset_of_file` choice applies, then stream it to the server.
	const utf8 = Readable.from(
		(async function* () {
			for await (const t of decodeText(ctx.bytes, ctx.charset)) yield Buffer.from(t, 'utf8');
		})()
	);
	run.seen = run.skip;
	await run.exec(sql, null, 1, { infileStreamFactory: () => utf8 });
};

// ---- spreadsheet / XML / MediaWiki -------------------------------------------------------------

async function nameForTable(run: ImportRun, db: string | null, index: number, given: string) {
	if (given !== '') return given;
	const n = db ? (await countNames(run, `SHOW TABLES FROM ${escapeId(db)}`)).length : 0;
	return `TABLE ${n + index + 1}`;
}

async function importTables(
	ctx: DriverContext,
	tables: TableData[],
	defaultDb: string
): Promise<void> {
	const { run, scope } = ctx;
	const db = scope.level === 'server' ? defaultDb : scope.db;
	await buildTables(run, db, tables, { createDb: scope.level === 'server', analyze: true });
}

export const odsDriver: Driver = async (ctx) => {
	const { run, options: o } = ctx;
	let sheets;
	try {
		sheets = parseOds(await collectBytes(ctx.bytes, ctx.memoryLimit), {
			colNames: bool(o, 'col_names'),
			emptyRows: bool(o, 'empty_rows'),
			recognizePercentages: bool(o, 'recognize_percentages'),
			recognizeCurrency: bool(o, 'recognize_currency')
		});
	} catch (e) {
		if (e instanceof OdsError) {
			run.fail(e.message);
			return;
		}
		throw e;
	}
	await importTables(ctx, sheets, 'ODS_DB');
};

export const xmlDriver: Driver = async (ctx) => {
	const { run, scope } = ctx;
	let doc;
	try {
		doc = parsePmaXml(await collectText(decodeText(ctx.bytes, ctx.charset), ctx.memoryLimit));
	} catch (e) {
		if (e instanceof XmlFormatError) {
			run.fail(e.message);
			return;
		}
		throw e;
	}
	const hasStructure = doc.structure.length > 0;
	const db = scope.level === 'server' ? doc.dbName : scope.db;
	await buildTables(run, db, doc.tables, {
		createDb: scope.level === 'server',
		charset: doc.charset,
		collation: doc.collation,
		analyze: !hasStructure,
		extraSql: doc.structure.map((s) => s.sql)
	});
};

export const mediawikiDriver: Driver = async (ctx) => {
	const { run, scope } = ctx;
	let wiki;
	try {
		wiki = parseMediaWiki(await collectText(decodeText(ctx.bytes, ctx.charset), ctx.memoryLimit));
	} catch (e) {
		if (e instanceof MediaWikiError) {
			run.fail(`Invalid format of mediawiki input on line: ${e.lineText}.`, e.line);
			return;
		}
		throw e;
	}
	if (scope.level === 'table') {
		// Insert into the existing table: header names when they all exist, else by position.
		const all = await listColumns(run, scope.db, scope.table);
		const target = `${escapeId(scope.db)}.${escapeId(scope.table)}`;
		for (const t of wiki) {
			const useHeaders = t.headers.length > 0 && t.headers.every((h) => all.includes(h));
			const cols = useHeaders
				? t.headers
				: all.slice(0, Math.max(...t.rows.map((r) => r.length), 0));
			if (!(await insertRows(run, target, cols, t.rows))) return;
		}
		return;
	}
	const db = scope.level === 'db' ? scope.db : null;
	const tables: TableData[] = [];
	for (let i = 0; i < wiki.length; i++) {
		const t = wiki[i];
		const width = Math.max(t.headers.length, ...t.rows.map((r) => r.length));
		const headers = [...t.headers];
		for (let k = headers.length; k < width; k++) headers.push(`COL ${k + 1}`);
		tables.push({
			name: await nameForTable(run, db, i, t.name),
			colNames: sanitizeColumnNames(headers),
			rows: t.rows.map((r) => {
				const row: Cell[] = [...r];
				while (row.length < width) row.push(null);
				return row;
			})
		});
	}
	await importTables(ctx, tables, 'mediawiki_DB');
};

export const DRIVERS: Record<ImportFormat, Driver> = {
	sql: sqlDriver,
	csv: csvDriver,
	ldi: ldiDriver,
	ods: odsDriver,
	xml: xmlDriver,
	mediawiki: mediawikiDriver
};

export { ImportAbort, CsvFormatError };
