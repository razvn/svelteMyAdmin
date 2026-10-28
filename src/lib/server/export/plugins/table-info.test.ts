import { describe, expect, it } from 'vitest';
import {
	displayDefault,
	loadColumns,
	nullableLabel,
	parseColumnRows,
	printColumnType
} from './table-info.ts';
import { BOOKS_COLUMN_ROWS, fakeConnection } from './testing.ts';

describe('printColumnType (Util::extractColumnSpec print_type)', () => {
	it('drops unsigned, zerofill and the BINARY attribute but keeps binary(n)', () => {
		expect(printColumnType('int(10) unsigned')).toBe('int(10)');
		expect(printColumnType('int unsigned')).toBe('int');
		expect(printColumnType('smallint(5) unsigned zerofill')).toBe('smallint(5)');
		expect(printColumnType('varchar(10) binary')).toBe('varchar(10)');
		expect(printColumnType('binary(8)')).toBe('binary(8)');
		expect(printColumnType('varbinary(64)')).toBe('varbinary(64)');
	});

	it('re-spaces enum and set values', () => {
		expect(printColumnType("enum('draft','published')")).toBe("enum('draft', 'published')");
		expect(printColumnType("set('a','b')")).toBe("set('a', 'b')");
	});

	it('lower-cases the type', () => {
		expect(printColumnType('VARCHAR(255)')).toBe('varchar(255)');
	});
});

describe('column display helpers', () => {
	it('shows NULL for nullable columns without a default, empty for NOT NULL', () => {
		const nullable = parseColumnRows([
			{ Field: 'a', Type: 'text', Null: 'YES', Key: '', Default: null }
		])[0];
		const notNull = parseColumnRows([
			{ Field: 'b', Type: 'int', Null: 'NO', Key: '', Default: null }
		])[0];
		expect(displayDefault(nullable!)).toBe('NULL');
		expect(displayDefault(notNull!)).toBe('');
		expect(nullableLabel(nullable!)).toBe('Yes');
		expect(nullableLabel(notNull!)).toBe('No');
	});

	it('parses SHOW FULL COLUMNS rows', () => {
		const columns = parseColumnRows(BOOKS_COLUMN_ROWS);
		expect(columns[0]).toEqual({
			field: 'id',
			type: 'int unsigned',
			null: 'NO',
			key: 'PRI',
			default: null,
			extra: 'auto_increment',
			comment: ''
		});
		expect(columns[3]?.default).toBe('0.00');
	});
});

describe('loadColumns', () => {
	it('reads SHOW FULL COLUMNS with escaped identifiers', async () => {
		let seen = '';
		const conn = fakeConnection([['SHOW FULL COLUMNS', BOOKS_COLUMN_ROWS]]);
		const original = conn.query.bind(conn);
		(conn as { query: unknown }).query = async (sql: unknown, params?: unknown) => {
			seen = typeof sql === 'string' ? sql : (sql as { sql: string }).sql;
			return original(sql as string, params as unknown[]);
		};
		const columns = await loadColumns(conn, 'my`db', 'books');
		expect(seen).toBe('SHOW FULL COLUMNS FROM `my``db`.`books`');
		expect(columns).toHaveLength(BOOKS_COLUMN_ROWS.length);
	});
});
