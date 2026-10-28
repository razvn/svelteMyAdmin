import { describe, expect, it } from 'vitest';
import {
	blankCell,
	buildInsert,
	buildUpdate,
	defaultFunction,
	functionGroups,
	isProtected,
	kindOf,
	parseEnumValues,
	renderStatement,
	toColumnMeta,
	type CellInput,
	type FormCell
} from './insert-edit.ts';

const col = (name: string, type: string, extra: Partial<Parameters<typeof toColumnMeta>[0]> = {}) =>
	toColumnMeta({
		field: name,
		type,
		null: true,
		key: '',
		default: null,
		extra: '',
		comment: '',
		...extra
	});

const cell = (o: Partial<FormCell> = {}): FormCell => ({
	value: '',
	setValues: [],
	isNull: false,
	func: '',
	salt: '',
	...o
});

const input = (
	type: string,
	c: Partial<FormCell>,
	extra: Partial<CellInput> = {},
	meta: Partial<Parameters<typeof toColumnMeta>[0]> = {}
): CellInput => ({ column: col('c', type, meta), cell: cell(c), ...extra });

const ins = (i: CellInput) => buildInsert('d', 't', [[i]])!;

describe('column model', () => {
	it('classifies types', () => {
		expect(kindOf('bigint')).toBe('int');
		expect(kindOf('varbinary')).toBe('binary');
		expect(kindOf('point')).toBe('spatial');
		expect(col('a', "enum('x','it''s')").enumValues).toEqual(['x', "it's"]);
		expect(parseEnumValues("set('a','b')")).toEqual(['a', 'b']);
		expect(col('a', 'int unsigned').trueType).toBe('int');
		expect(col('a', 'int', { extra: 'VIRTUAL GENERATED' }).generated).toBe(true);
		expect(col('a', 'int', { extra: 'DEFAULT_GENERATED' }).generated).toBe(false);
	});

	it('groups functions with own class first', () => {
		expect(functionGroups(col('a', 'datetime'))[0].label).toBe('Date and time');
		expect(functionGroups(col('a', 'varchar(5)'))[0].functions).toContain('MD5');
		expect(functionGroups(col('a', 'int'))[0].functions).toContain('ABS');
	});

	it('default functions follow config', () => {
		const config = { FUNC_SPATIAL: 'GeomFromText', first_timestamp: 'NOW', FUNC_UUID: 'UUID' };
		const o = { insertMode: true, firstTimestamp: true, config };
		expect(defaultFunction(col('g', 'point'), o)).toBe('ST_GeomFromText');
		expect(defaultFunction(col('t', 'timestamp', { null: false }), o)).toBe('NOW');
		expect(
			defaultFunction(col('t', 'timestamp', { null: false }), { ...o, insertMode: false })
		).toBe('');
		expect(defaultFunction(col('id', 'char(36)', { key: 'PRI' }), o)).toBe('UUID');
	});

	it('protects binary per config', () => {
		expect(isProtected(col('a', 'blob'), 'blob')).toBe(true);
		expect(isProtected(col('a', 'binary(4)'), 'blob')).toBe(false);
		expect(isProtected(col('a', 'blob'), 'noblob')).toBe(false);
		expect(isProtected(col('a', 'varchar(3)'), 'all')).toBe(false);
		expect(isProtected(col('a', 'blob'), false)).toBe(false);
	});

	it('prefills blank cells', () => {
		expect(blankCell(col('a', 'int')).isNull).toBe(true);
		expect(blankCell(col('a', 'int', { null: false })).isNull).toBe(false);
		expect(blankCell(col('a', 'bit(3)', { default: "b'101'" })).value).toBe('101');
		const enumCol = col('a', "enum('s','m')", { default: 'm' });
		expect(blankCell(enumCol).value).toBe('m');
		expect(blankCell(col('a', "set('a','b')", { default: 'a,b' })).setValues).toEqual(['a', 'b']);
		expect(blankCell(col('a', 'int', { extra: 'auto_increment', null: false })).isNull).toBe(false);
	});
});

describe('INSERT', () => {
	it('binds values as parameters', () => {
		const st = buildInsert('d', 't', [
			[
				{ column: col('a', 'int'), cell: cell({ value: '5' }) },
				{ column: col('b', 'varchar(9)'), cell: cell({ value: "it's" }) }
			]
		])!;
		expect(st.sql).toBe('INSERT INTO `d`.`t` (`a`, `b`) VALUES (?, ?)');
		expect(st.params).toEqual(['5', "it's"]);
		expect(renderStatement(st)).toBe("INSERT INTO `d`.`t` (`a`, `b`) VALUES ('5', 'it\\'s')");
	});

	it('inserts several rows and INSERT IGNORE', () => {
		const row = (v: string): CellInput[] => [{ column: col('a', 'int'), cell: cell({ value: v }) }];
		const st = buildInsert('d', 't', [row('1'), row('2')], { ignore: true })!;
		expect(st.sql).toBe('INSERT IGNORE INTO `d`.`t` (`a`) VALUES (?), (?)');
		expect(st.params).toEqual(['1', '2']);
	});

	it('NULL semantics', () => {
		expect(ins(input('int', { isNull: true })).sql).toContain('VALUES (NULL)');
		// empty string is sent as '' (like phpMyAdmin), auto_increment becomes NULL
		expect(ins(input('varchar(3)', {})).params).toEqual(['']);
		expect(ins(input('int', {}, {}, { extra: 'auto_increment' })).sql).toContain('VALUES (NULL)');
		// a value wins over the Null checkbox
		expect(ins(input('varchar(3)', { value: 'x', isNull: true })).params).toEqual(['x']);
	});

	it('skips generated columns', () => {
		const st = buildInsert('d', 't', [
			[
				{ column: col('g', 'int', { extra: 'STORED GENERATED' }), cell: cell({ value: '1' }) },
				{ column: col('a', 'int'), cell: cell({ value: '2' }) }
			]
		])!;
		expect(st.sql).toBe('INSERT INTO `d`.`t` (`a`) VALUES (?)');
	});

	it('numbers, dates, year, json, text, enum', () => {
		for (const t of [
			'bigint',
			'decimal(5,2)',
			'double',
			'date',
			'time',
			'year',
			'json',
			'text',
			"enum('a')"
		]) {
			expect(ins(input(t, { value: '7' })).params).toEqual(['7']);
		}
	});

	it('current_timestamp literal on date types only', () => {
		expect(renderStatement(ins(input('datetime', { value: 'current_timestamp(3)' })))).toContain(
			'VALUES (CURRENT_TIMESTAMP(3))'
		);
		expect(ins(input('timestamp', { value: 'CURRENT_TIMESTAMP' })).sql).toContain(
			'(CURRENT_TIMESTAMP)'
		);
		expect(ins(input('varchar(30)', { value: 'CURRENT_TIMESTAMP' })).params).toEqual([
			'CURRENT_TIMESTAMP'
		]);
	});

	it('bit columns', () => {
		expect(ins(input('bit(8)', { value: '10102' })).sql).toContain("VALUES (b'10100')");
	});

	it('set values are joined', () => {
		const st = ins({ column: col('s', "set('a','b','c')"), cell: cell({ setValues: ['a', 'c'] }) });
		expect(st.params).toEqual(['a,c']);
		expect(ins({ column: col('s', "set('a')"), cell: cell({ isNull: true }) }).sql).toContain(
			'(NULL)'
		);
	});

	it('binary: hex text becomes a Buffer, uploads too', () => {
		const st = ins(input('varbinary(8)', { value: '0xDEADBEEF' }));
		expect(Buffer.from(st.params[0] as Uint8Array).toString('hex')).toBe('deadbeef');
		expect(() => ins(input('blob', { value: 'zz' }))).toThrow(/hexadecimal/);
		const up = ins(input('blob', {}, { upload: Buffer.from([1, 2, 3]) }));
		expect(renderStatement(up)).toContain('VALUES (0x010203)');
	});

	it('protected binary: omitted, or copied from the source row', () => {
		const c = col('b', 'blob');
		const a = col('a', 'int');
		const st = buildInsert('d', 't', [
			[
				{ column: a, cell: cell({ value: '1' }) },
				{ column: c, cell: cell(), isProtected: true }
			]
		])!;
		expect(st.sql).toBe('INSERT INTO `d`.`t` (`a`) VALUES (?)');
		const copy = buildInsert('d', 't', [
			[{ column: c, cell: cell(), isProtected: true, protectedOriginal: Buffer.from([9]) }]
		])!;
		expect(renderStatement(copy)).toContain('(0x09)');
	});

	it('expression defaults use DEFAULT', () => {
		const st = ins(input('varchar(36)', {}, {}, { extra: 'DEFAULT_GENERATED' }));
		expect(st.sql).toContain('VALUES (DEFAULT)');
	});

	it('uuid type generates a value when empty', () => {
		expect(ins(input('uuid', {})).sql).toContain('VALUES (UUID())');
	});

	it('applies functions with parameters', () => {
		expect(ins(input('varchar(40)', { value: 'x', func: 'MD5' })).sql).toContain('VALUES (MD5(?))');
		expect(ins(input('varbinary(8)', { value: 'ab', func: 'UNHEX' })).sql).toContain('(UNHEX(?))');
		expect(ins(input('datetime', { func: 'NOW' })).sql).toContain('(NOW())');
		expect(ins(input('datetime', { func: 'NOW', value: '3' })).sql).toContain('(NOW(3))');
		expect(ins(input('char(36)', { func: 'UUID' })).sql).toContain('(UUID())');
		const aes = ins(input('blob', { value: 'secret', func: 'AES_ENCRYPT', salt: 'k' }));
		expect(aes.sql).toContain('(AES_ENCRYPT(?, ?))');
		expect(aes.params).toEqual(['secret', 'k']);
		expect(ins(input('char(36)', { value: 'a', func: 'ENCRYPT', salt: 'ss' })).params).toEqual([
			'a',
			'ss'
		]);
	});

	it('spatial functions keep the SRID', () => {
		const st = ins(input('point', { value: "'POINT(1 2)',4326", func: 'ST_GeomFromText' }));
		expect(st.sql).toContain('(ST_GeomFromText(?, 4326))');
		expect(st.params).toEqual(['POINT(1 2)']);
		expect(ins(input('point', { value: 'POINT(1 2)', func: 'ST_PointFromText' })).params).toEqual([
			'POINT(1 2)'
		]);
	});

	it('rejects unknown functions and NULL beats a function', () => {
		expect(() => ins(input('int', { value: '1', func: 'SLEEP' }))).toThrow(/Unknown function/);
		expect(ins(input('int', { func: 'ABS', isNull: true })).sql).toContain('(NULL)');
	});

	it('copy mode: auto_increment column left empty becomes NULL', () => {
		const st = buildInsert('d', 't', [
			[
				{
					column: col('id', 'int', { extra: 'auto_increment', key: 'PRI' }),
					cell: cell({ value: '' })
				},
				{ column: col('n', 'varchar(9)'), cell: cell({ value: 'copy' }) }
			]
		])!;
		expect(renderStatement(st)).toBe("INSERT INTO `d`.`t` (`id`, `n`) VALUES (NULL, 'copy')");
	});
});

describe('UPDATE', () => {
	const up = (cells: CellInput[]) => buildUpdate('d', 't', cells, '`id` = 1');

	it('only changed columns, LIMIT 1', () => {
		const st = up([
			{ column: col('a', 'int'), cell: cell({ value: '1', prev: '1' }) },
			{ column: col('b', 'varchar(9)'), cell: cell({ value: 'new', prev: 'old' }) }
		])!;
		expect(st.sql).toBe('UPDATE `d`.`t` SET `b` = ? WHERE `id` = 1 LIMIT 1');
		expect(st.params).toEqual(['new']);
	});

	it('no change gives no statement', () => {
		expect(up([{ column: col('a', 'int'), cell: cell({ value: '1', prev: '1' }) }])).toBeNull();
		expect(
			up([{ column: col('a', 'int'), cell: cell({ isNull: true, prevNull: true, prev: '' }) }])
		).toBeNull();
	});

	it('null transitions', () => {
		expect(
			up([{ column: col('a', 'int'), cell: cell({ isNull: true, prev: '3' }) }])!.sql
		).toContain('`a` = NULL');
		const st = up([
			{ column: col('a', 'int'), cell: cell({ value: '', prevNull: true, prev: '' }) }
		])!;
		expect(st.params).toEqual(['']);
	});

	it('functions are always applied, protected columns left alone, uploads replace', () => {
		const st = up([
			{ column: col('a', 'datetime'), cell: cell({ value: '', prev: 'x', func: 'NOW' }) },
			{ column: col('p', 'blob'), cell: cell({ prev: '' }), isProtected: true },
			{ column: col('u', 'blob'), cell: cell(), upload: Buffer.from('hi') }
		])!;
		expect(st.sql).toBe('UPDATE `d`.`t` SET `a` = NOW(), `u` = ? WHERE `id` = 1 LIMIT 1');
	});

	it('set and bit compare against prev', () => {
		expect(
			up([{ column: col('s', "set('a','b')"), cell: cell({ setValues: ['a'], prev: 'a' }) }])
		).toBeNull();
		const st = up([{ column: col('b', 'bit(4)'), cell: cell({ value: '0101', prev: '0001' }) }])!;
		expect(st.sql).toContain("`b` = b'0101'");
	});

	it('unique clause drops LIMIT', () => {
		const st = buildUpdate(
			'd',
			't',
			[{ column: col('a', 'int'), cell: cell({ value: '2', prev: '1' }) }],
			'`id` = 1',
			{ clauseIsUnique: true }
		)!;
		expect(st.sql.endsWith('WHERE `id` = 1')).toBe(true);
	});
});
