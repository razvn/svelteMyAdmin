import { describe, expect, it } from 'vitest';
import type { ColumnInfo, IndexInfo } from '#lib/server/db/dbi.ts';
import {
	conditionColumns,
	printableBitValue,
	uniqueCondition,
	type ConditionColumn
} from './unique-condition.ts';

const col = (
	name: string,
	kind: ConditionColumn['kind'],
	key: ConditionColumn['key'] = null,
	bitLength?: number
): ConditionColumn => ({ name, kind, key, bitLength });

describe('uniqueCondition', () => {
	it('uses the primary key only', () => {
		const r = uniqueCondition(
			't',
			[col('id', 'integer', 'primary'), col('name', 'text')],
			[7, 'x']
		);
		expect(r).toEqual({
			clause: '`t`.`id` = 7',
			isUnique: true,
			parts: { '`t`.`id`': '= 7' }
		});
	});

	it('joins composite primary keys with AND', () => {
		const r = uniqueCondition(
			't',
			[col('a', 'integer', 'primary'), col('b', 'text', 'primary'), col('c', 'text')],
			[1, "it's", 'z']
		);
		expect(r.clause).toBe("`t`.`a` = 1 AND `t`.`b` = 'it\\'s'");
		expect(r.isUnique).toBe(true);
	});

	it('prefers primary over unique and unique over everything', () => {
		const cols = [col('u', 'text', 'unique'), col('p', 'integer', 'primary'), col('o', 'text')];
		expect(uniqueCondition('t', cols, ['a', 1, 'b']).clause).toBe('`t`.`p` = 1');
		const noPk = [col('u', 'text', 'unique'), col('o', 'text')];
		expect(uniqueCondition('t', noPk, ['a', 'b']).clause).toBe("`t`.`u` = 'a'");
	});

	it('falls back to all columns, not unique', () => {
		const r = uniqueCondition('t', [col('a', 'integer'), col('b', 'text')], [1, null]);
		expect(r.clause).toBe('`t`.`a` = 1 AND `t`.`b` IS NULL');
		expect(r.isUnique).toBe(false);
	});

	it('returns an empty clause when forceUnique finds no key', () => {
		const r = uniqueCondition('t', [col('a', 'integer')], [1], true);
		expect(r).toEqual({ clause: '', isUnique: false, parts: {} });
	});

	it('quotes NULL as IS NULL for a key column', () => {
		const r = uniqueCondition('t', [col('a', 'text', 'unique')], [null]);
		expect(r.clause).toBe('`t`.`a` IS NULL');
	});

	it('escapes quotes and backslashes in strings and backticks in identifiers', () => {
		const r = uniqueCondition('t`x', [col('we`ird', 'text', 'primary')], ['a\'b\\c"']);
		expect(r.clause).toBe("`t``x`.`we``ird` = 'a\\'b\\\\c\\\"'");
	});

	it('never leaves a non-numeric string unquoted in a numeric column', () => {
		const r = uniqueCondition('t', [col('a', 'integer', 'primary')], ['1 OR 1=1']);
		expect(r.clause).toBe("`t`.`a` = '1 OR 1=1'");
	});

	it('keeps big integers and decimals verbatim', () => {
		const r = uniqueCondition(
			't',
			[col('a', 'integer', 'primary'), col('b', 'decimal', 'primary')],
			['18446744073709551615', '-12.500000']
		);
		expect(r.clause).toBe('`t`.`a` = 18446744073709551615 AND `t`.`b` = -12.500000');
	});

	it('wraps floats in CONCAT, also for NULL', () => {
		const cols = [col('f', 'real', 'primary')];
		expect(uniqueCondition('t', cols, ['1.5']).clause).toBe('CONCAT(`t`.`f`) = 1.5');
		expect(uniqueCondition('t', cols, [null]).clause).toBe('CONCAT(`t`.`f`) IS NULL');
	});

	it('hexifies binary values with CAST', () => {
		const r = uniqueCondition('t', [col('b', 'binary', 'primary')], [Buffer.from([0xde, 0xad])]);
		expect(r.clause).toBe('`t`.`b` = CAST(0xdead AS BINARY)');
	});

	it('compares an empty binary value with an empty string', () => {
		const r = uniqueCondition('t', [col('b', 'binary', 'primary')], [Buffer.alloc(0)]);
		expect(r.clause).toBe("`t`.`b` = ''");
	});

	it('skips large binary values, or compares the length when it is the only column', () => {
		const big = Buffer.alloc(1500, 1);
		const two = uniqueCondition('t', [col('a', 'integer'), col('b', 'binary')], [1, big]);
		expect(two.clause).toBe('`t`.`a` = 1');
		const one = uniqueCondition('t', [col('b', 'binary')], [big]);
		expect(one.clause).toBe('CHAR_LENGTH(`t`.`b`) = 1500');
	});

	it('formats bit values as b literals padded to the column width', () => {
		const r = uniqueCondition('t', [col('b', 'bit', 'primary', 8)], [Buffer.from([0x0a])]);
		expect(r.clause).toBe("`t`.`b` = b'00001010'");
		expect(printableBitValue(5n, 4)).toBe('0101');
	});

	it('leaves geometry out unless raw bytes are given', () => {
		const cols = [col('id', 'integer'), col('g', 'geometry')];
		expect(uniqueCondition('t', cols, [1, 'POINT(1 2)']).clause).toBe('`t`.`id` = 1');
		expect(uniqueCondition('t', cols, [1, Buffer.from([1, 2])]).clause).toBe(
			'`t`.`id` = 1 AND `t`.`g` = CAST(0x0102 AS BINARY)'
		);
	});

	it('quotes temporal and enum values as strings', () => {
		const r = uniqueCondition(
			't',
			[col('d', 'temporal', 'primary'), col('e', 'enum', 'primary')],
			['2024-02-29 13:45:10.123', 'large']
		);
		expect(r.clause).toBe("`t`.`d` = '2024-02-29 13:45:10.123' AND `t`.`e` = 'large'");
	});
});

const column = (field: string, type: string, nullable = false): ColumnInfo => ({
	field,
	type,
	collation: null,
	null: nullable,
	key: '',
	default: null,
	extra: '',
	privileges: '',
	comment: ''
});
const index = (keyName: string, columnName: string, seq: number, nonUnique = false): IndexInfo => ({
	table: 't',
	nonUnique,
	keyName,
	seqInIndex: seq,
	columnName,
	collation: 'A',
	cardinality: null,
	subPart: null,
	packed: null,
	nullable: false,
	indexType: 'BTREE',
	comment: '',
	indexComment: '',
	expression: null
});

describe('conditionColumns', () => {
	it('marks the primary key', () => {
		const cols = conditionColumns(
			[column('a', 'int'), column('b', 'varchar(5)')],
			[index('PRIMARY', 'a', 1), index('idx', 'b', 1, true)]
		);
		expect(cols.map((c) => c.key)).toEqual(['primary', null]);
		expect(cols.map((c) => c.kind)).toEqual(['integer', 'text']);
	});

	it('keeps composite unique keys whole and ignores nullable ones', () => {
		const columns = [column('a', 'int'), column('b', 'int'), column('n', 'int', true)];
		const cols = conditionColumns(columns, [
			index('uq_n', 'n', 1),
			index('uq_ab', 'a', 1),
			index('uq_ab', 'b', 2)
		]);
		expect(cols.map((c) => c.key)).toEqual(['unique', 'unique', null]);
	});

	it('has no key columns without a usable index', () => {
		const cols = conditionColumns([column('n', 'int', true)], [index('uq', 'n', 1)]);
		expect(cols[0].key).toBeNull();
	});

	it('records bit widths', () => {
		expect(conditionColumns([column('b', 'bit(8)')], [])[0].bitLength).toBe(8);
	});
});
