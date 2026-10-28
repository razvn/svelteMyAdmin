/**
 * Test helpers for the export plugins: a fake ExportContext that collects writes, a DB-less
 * ExportData built from an array of rows, and one fixed dataset covering NULL, quotes,
 * separators, newlines, unicode, numbers, empty values and binary values.
 */
import type { Connection } from '#lib/server/db/connection.ts';
import type {
	ExportCell,
	ExportContext,
	ExportData,
	ExportField,
	ExportOptionValues,
	ExportScope,
	ExportTableRef
} from '../types.ts';

export interface TestExport {
	ctx: ExportContext;
	/** All bytes written so far. */
	bytes(): Buffer;
	/** All bytes written so far, decoded as UTF-8. */
	text(): string;
}

const noConnection = {
	query: async () => {
		throw new Error('no database connection in unit tests');
	}
} as unknown as Connection;

export function createTestContext(
	options: ExportOptionValues = {},
	init: { scope?: ExportScope; crlf?: string; conn?: Connection } = {}
): TestExport {
	const chunks: Buffer[] = [];
	const ctx: ExportContext = {
		write: async (chunk) => {
			chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk));
		},
		conn: init.conn ?? noConnection,
		scope: init.scope ?? 'database',
		options,
		crlf: init.crlf ?? '\n',
		server: { version: '8.4.4', isMariaDb: false, host: 'localhost' },
		appVersion: '0.0.1',
		now: new Date(2026, 9, 28, 21, 41, 5)
	};
	return {
		ctx,
		bytes: () => Buffer.concat(chunks),
		text: () => Buffer.concat(chunks).toString('utf8')
	};
}

type FakeRows = Record<string, unknown>[];

/**
 * Connection stub answering metadata queries from a list of [substring, rows] pairs. The first
 * pair whose substring occurs in the SQL wins. `rowsAsArray` queries get the row values as arrays.
 */
export function fakeConnection(responses: [string, FakeRows][]): Connection {
	const query = async (sqlOrOptions: unknown) => {
		const options =
			typeof sqlOrOptions === 'string'
				? { sql: sqlOrOptions, rowsAsArray: false }
				: (sqlOrOptions as { sql: string; rowsAsArray?: boolean });
		const match = responses.find(([needle]) => options.sql.includes(needle));
		if (!match) throw new Error(`unexpected query in test: ${options.sql}`);
		const rows = options.rowsAsArray ? match[1].map((row) => Object.values(row)) : match[1];
		return [rows, []];
	};
	return { query } as unknown as Connection;
}

export function field(
	name: string,
	type: string,
	extra: Partial<Omit<ExportField, 'name' | 'type'>> = {}
): ExportField {
	return {
		name,
		type,
		isBinary: false,
		isNumeric: false,
		nullable: true,
		...extra
	};
}

export function makeExportData(input: {
	db?: string;
	table?: string;
	alias?: string;
	kind?: 'table' | 'view';
	fields: ExportField[];
	rows: ExportCell[][];
}): ExportData {
	const ref: ExportTableRef = {
		db: input.db ?? 'sma_test',
		table: input.table ?? 'books',
		alias: input.alias,
		kind: input.kind ?? 'table'
	};
	const rows = input.rows;
	return {
		ref,
		fields: input.fields,
		sql: `SELECT * FROM \`${ref.db}\`.\`${ref.table}\``,
		rows: (async function* () {
			for (const row of rows) yield row;
		})()
	};
}

/** Fixed dataset shared by the golden-output tests. */
export const FIXTURE_FIELDS: ExportField[] = [
	field('id', 'int', { isNumeric: true, nullable: false }),
	field('name', 'varchar'),
	field('note', 'text'),
	field('price', 'decimal', { isNumeric: true }),
	field('payload', 'blob', { isBinary: true })
];

export const FIXTURE_ROWS: ExportCell[][] = [
	['1', 'Plain', 'simple', '9.99', Buffer.from('bin')],
	['2', 'Quote "x", semi;colon', 'line one\nline two\r\nline three', null, null],
	['3', 'Ünïcode ✓ 日本', 'tab\there\\back', '0', Buffer.from('q"\nz')],
	['4', "Apos ' & <tag>", '', '-12.50', Buffer.alloc(0)]
];

/** SHOW FULL COLUMNS rows of sma_test.books (MySQL 8.4 spelling). */
export const BOOKS_COLUMN_ROWS: Record<string, unknown>[] = [
	{
		Field: 'id',
		Type: 'int unsigned',
		Null: 'NO',
		Key: 'PRI',
		Default: null,
		Extra: 'auto_increment',
		Comment: ''
	},
	{
		Field: 'author_id',
		Type: 'int unsigned',
		Null: 'NO',
		Key: 'MUL',
		Default: null,
		Extra: '',
		Comment: ''
	},
	{
		Field: 'title',
		Type: 'varchar(200)',
		Null: 'NO',
		Key: 'UNI',
		Default: null,
		Extra: '',
		Comment: ''
	},
	{
		Field: 'price',
		Type: 'decimal(8,2)',
		Null: 'NO',
		Key: '',
		Default: '0.00',
		Extra: '',
		Comment: ''
	},
	{
		Field: 'published_at',
		Type: 'datetime',
		Null: 'YES',
		Key: '',
		Default: null,
		Extra: '',
		Comment: ''
	},
	{
		Field: 'status',
		Type: "enum('draft','published','archived')",
		Null: 'NO',
		Key: '',
		Default: 'draft',
		Extra: '',
		Comment: ''
	}
];

/** SHOW INDEX rows: `id` is the primary key, `title` a unique index, `author_id` non-unique. */
export const BOOKS_INDEX_ROWS: Record<string, unknown>[] = [
	{ Table: 'books', Non_unique: 0, Key_name: 'PRIMARY', Column_name: 'id' },
	{ Table: 'books', Non_unique: 0, Key_name: 'uq_title', Column_name: 'title' },
	{ Table: 'books', Non_unique: 1, Key_name: 'idx_author', Column_name: 'author_id' }
];

export function booksConnection(extra: [string, Record<string, unknown>[]][] = []): Connection {
	return fakeConnection([
		['SHOW FULL COLUMNS', BOOKS_COLUMN_ROWS],
		['SHOW INDEX', BOOKS_INDEX_ROWS],
		[
			'SHOW CREATE TABLE',
			[
				{
					Table: 'books',
					'Create Table': 'CREATE TABLE `books` (\n  `id` int unsigned NOT NULL\n)'
				}
			]
		],
		['information_schema.TRIGGERS', []],
		['information_schema.SCHEMATA', [{ charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' }]],
		...extra
	]);
}

export function fixtureData(alias?: string): ExportData {
	return makeExportData({
		table: 'books',
		alias,
		fields: FIXTURE_FIELDS,
		rows: FIXTURE_ROWS
	});
}
