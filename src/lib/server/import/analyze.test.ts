import { describe, expect, it } from 'vitest';
import {
	analyzeTable,
	BIGINT,
	columnAlphaName,
	columnNumberFromName,
	columnType,
	DATE,
	DECIMAL,
	decimalSize,
	detectSize,
	detectType,
	INT,
	NONE,
	VARCHAR,
	type CellType
} from './analyze.ts';

describe('detectType (phpMyAdmin ImportTest cases)', () => {
	const cases: [CellType | null, string, CellType][] = [
		[null, 'NULL', NONE],
		[NONE, 'NULL', NONE],
		[INT, 'NULL', INT],
		[VARCHAR, 'NULL', VARCHAR],
		[null, 'text', VARCHAR],
		[null, '', VARCHAR],
		[null, '10', INT],
		[null, '-10', INT],
		[null, '0', INT],
		[null, '2147483647', INT],
		[null, '2147483648', BIGINT],
		[null, '-2147483649', BIGINT],
		[null, '9223372036854775808', VARCHAR],
		[null, '007', VARCHAR],
		[null, '+5', VARCHAR],
		[null, '1e5', VARCHAR],
		[null, '1.5', DECIMAL],
		[null, '-0.25', DECIMAL],
		[null, '1.2.3', VARCHAR],
		[null, '2024-02-29', DATE],
		[null, '2024-13-01', VARCHAR]
	];
	it.each(cases)('%s / %s', (last, cell, expected) => {
		expect(detectType(last, cell)).toBe(expected);
	});
});

describe('detectSize', () => {
	it('ignores NULL', () => {
		expect(detectSize(4, VARCHAR, VARCHAR, 'NULL')).toBe(4);
	});
	it('varchar grows', () => {
		expect(detectSize(0, NONE, VARCHAR, 'abc')).toBe(3);
		expect(detectSize(3, VARCHAR, VARCHAR, 'abcdef')).toBe(6);
		expect(detectSize(6, VARCHAR, VARCHAR, 'ab')).toBe(6);
	});
	it('decimal size is M,D', () => {
		expect(decimalSize('12.345')).toEqual([5, 3, '5,3']);
		expect(detectSize(0, NONE, DECIMAL, '12.345')).toBe('5,3');
		expect(detectSize('5,3', DECIMAL, DECIMAL, '1.5')).toBe('5,3');
		expect(detectSize('5,3', DECIMAL, DECIMAL, '123456.5')).toBe('7,3');
	});
	it('int into decimal keeps the larger integer part', () => {
		expect(detectSize('5,3', DECIMAL, INT, '12')).toBe('5,3');
		expect(detectSize('5,3', DECIMAL, INT, '123456')).toBe('9,3');
	});
	it('decimal after int', () => {
		expect(detectSize(2, INT, DECIMAL, '1.25')).toBe('3,2');
		expect(detectSize(5, INT, DECIMAL, '1.25')).toBe('5,2');
	});
});

describe('analyzeTable', () => {
	it('picks int, decimal, varchar, date, bigint', () => {
		const rows = [
			['1', '1.5', 'abc', '2020-01-01', 'NULL', '9999999999'],
			['22', '10.25', 'abcdef', '2021-12-31', 'NULL', '1']
		];
		const a = analyzeTable(['a', 'b', 'c', 'd', 'e', 'f'], rows);
		expect(a.types).toEqual([INT, DECIMAL, VARCHAR, DATE, VARCHAR, BIGINT]);
		expect(columnType(a.types[0], a.sizes[0])).toBe('int');
		expect(columnType(a.types[1], a.sizes[1])).toBe('decimal(4,2)');
		expect(columnType(a.types[2], a.sizes[2])).toBe('varchar(6)');
		expect(columnType(a.types[3], a.sizes[3])).toBe('date');
		expect(columnType(a.types[4], a.sizes[4])).toBe('varchar(10)');
		expect(columnType(a.types[5], a.sizes[5])).toBe('bigint');
	});
	it('a text cell turns a numeric column into varchar', () => {
		const a = analyzeTable(['a'], [['1'], ['two'], ['3']]);
		expect(a.types[0]).toBe(VARCHAR);
		expect(columnType(a.types[0], a.sizes[0])).toBe('varchar(3)');
	});
	it('int and decimal mix to decimal in either order', () => {
		expect(analyzeTable(['a'], [['1.5'], ['2']]).types[0]).toBe(DECIMAL);
		expect(analyzeTable(['a'], [['2'], ['1.5']]).types[0]).toBe(DECIMAL);
	});
	it('dates mixed with numbers are text', () => {
		const a = analyzeTable(['a'], [['2020-01-01'], ['5']]);
		expect(a.types[0]).toBe(VARCHAR);
		expect(columnType(a.types[0], a.sizes[0])).toBe('varchar(10)');
	});
	it('long strings become text', () => {
		const a = analyzeTable(['a'], [['x'.repeat(300)]]);
		expect(columnType(a.types[0], a.sizes[0])).toBe('text');
	});
	it('an empty table gives varchar(10)', () => {
		const a = analyzeTable(['a'], []);
		expect(columnType(a.types[0], a.sizes[0])).toBe('varchar(10)');
	});
});

describe('column names', () => {
	const cases: [number, string][] = [
		[1, 'A'],
		[26, 'Z'],
		[27, 'AA'],
		[52, 'AZ'],
		[53, 'BA'],
		[702, 'ZZ'],
		[703, 'AAA']
	];
	it.each(cases)('%d <-> %s', (n, name) => {
		expect(columnAlphaName(n)).toBe(name);
		expect(columnNumberFromName(name)).toBe(n);
	});
});
