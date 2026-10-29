import { describe, expect, it } from 'vitest';
import { applyHidden } from './hidden.ts';
import { addTable, hasTable, parseTables, removeTable, serializeTables } from './recent.ts';

const t = (db: string, table: string) => ({ db, table });

describe('recent / favorite list operations', () => {
	it('puts the newest first and deduplicates', () => {
		let list = addTable([], t('a', 'x'), 10);
		list = addTable(list, t('a', 'y'), 10);
		list = addTable(list, t('b', 'x'), 10);
		list = addTable(list, t('a', 'x'), 10);
		expect(list).toEqual([t('a', 'x'), t('b', 'x'), t('a', 'y')]);
	});

	it('keeps the list unchanged when the newest is visited again', () => {
		const list = [t('a', 'x'), t('a', 'y')];
		expect(addTable(list, t('a', 'x'), 10)).toEqual(list);
	});

	it('trims to the maximum, dropping the oldest', () => {
		let list: ReturnType<typeof addTable> = [];
		for (const n of ['1', '2', '3', '4']) list = addTable(list, t('d', n), 3);
		expect(list.map((x) => x.table)).toEqual(['4', '3', '2']);
		expect(addTable(list, t('d', '9'), 0)).toEqual([]);
	});

	it('removes and finds entries', () => {
		const list = [t('a', 'x'), t('a', 'y')];
		expect(hasTable(list, t('a', 'y'))).toBe(true);
		expect(removeTable(list, t('a', 'y'))).toEqual([t('a', 'x')]);
		expect(hasTable(removeTable(list, t('a', 'y')), t('a', 'y'))).toBe(false);
	});
});

describe('JSON compatibility with phpMyAdmin', () => {
	it('reads what PHP json_encode writes (escaped slashes and unicode)', () => {
		const php = '[{"db":"sma_test","table":"a\\/b"},{"db":"d\\u00e9","table":"t"}]';
		expect(parseTables(php)).toEqual([t('sma_test', 'a/b'), t('dé', 't')]);
	});

	it('reads the object form PHP writes after an unset', () => {
		expect(parseTables('{"1":{"db":"a","table":"x"},"3":{"db":"a","table":"y"}}')).toEqual([
			t('a', 'x'),
			t('a', 'y')
		]);
	});

	it('serializes to the {db, table} shape and round-trips', () => {
		const list = [t('a', 'x'), t('b', 'y')];
		expect(serializeTables(list)).toBe('[{"db":"a","table":"x"},{"db":"b","table":"y"}]');
		expect(parseTables(serializeTables(list))).toEqual(list);
	});

	it('ignores garbage', () => {
		expect(parseTables(null)).toEqual([]);
		expect(parseTables('')).toEqual([]);
		expect(parseTables('not json')).toEqual([]);
		expect(parseTables('[1,"x",{"db":1,"table":"t"},{"db":"a","table":"b"}]')).toEqual([
			t('a', 'b')
		]);
	});
});

describe('applyHidden', () => {
	const children = {
		db: 'd',
		tables: ['a', 'b'],
		views: ['b'],
		procedures: ['p'],
		functions: ['f'],
		events: ['e']
	};

	it('filters by item type', () => {
		const out = applyHidden(children, [
			{ name: 'b', type: 'table' },
			{ name: 'e', type: 'event' }
		]);
		expect(out.tables).toEqual(['a']);
		expect(out.views).toEqual(['b']);
		expect(out.events).toEqual([]);
		expect(out.procedures).toEqual(['p']);
	});

	it('does not mutate the input', () => {
		applyHidden(children, [{ name: 'a', type: 'table' }]);
		expect(children.tables).toEqual(['a', 'b']);
	});
});
