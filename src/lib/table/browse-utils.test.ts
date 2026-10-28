import { describe, expect, it } from 'vitest';
import {
	buildOrderBy,
	formatSortedCol,
	parseSort,
	parseSortedCol
} from '#lib/server/table/order-by.ts';
import { columnKind, parseEnumValues } from './column-kind.ts';
import {
	canShowAll,
	pageChoices,
	pageSize,
	paginate,
	parseRows,
	rowsOptions
} from './pagination.ts';
import { nextSort } from './sort.ts';

describe('buildOrderBy', () => {
	const cols = ['id', 'title', 'we`ird'];
	it('builds from validated names only', () => {
		expect(
			buildOrderBy(
				[
					{ column: 'title', dir: 'desc' },
					{ column: 'nope; DROP TABLE x', dir: 'asc' },
					{ column: 'id', dir: 'asc' }
				],
				cols
			)
		).toBe('ORDER BY `title` DESC, `id` ASC');
	});
	it('escapes backticks', () => {
		expect(buildOrderBy([{ column: 'we`ird', dir: 'asc' }], cols)).toBe('ORDER BY `we``ird` ASC');
	});
	it('is empty without valid sort keys', () => {
		expect(buildOrderBy([], cols)).toBe('');
		expect(buildOrderBy([{ column: 'x', dir: 'asc' }], cols)).toBe('');
	});
});

describe('parseSort / sorted_col', () => {
	it('validates column and direction', () => {
		expect(parseSort('title', 'DESC', ['title'])).toEqual({ column: 'title', dir: 'desc' });
		expect(parseSort('title', 'sideways', ['title'])).toEqual({ column: 'title', dir: 'asc' });
		expect(parseSort('x', 'asc', ['title'])).toBeNull();
		expect(parseSort(null, null, ['title'])).toBeNull();
	});
	it('round-trips the phpMyAdmin uiprefs format', () => {
		const s = { column: 'a`b', dir: 'desc' as const };
		const text = formatSortedCol('t', s);
		expect(text).toBe('`t`.`a``b` DESC');
		expect(parseSortedCol(text, ['a`b'])).toEqual(s);
		expect(parseSortedCol('garbage', ['a'])).toBeNull();
		expect(parseSortedCol(5, ['a'])).toBeNull();
	});
});

describe('nextSort', () => {
	it('cycles asc, desc, none', () => {
		const a = nextSort(null, 'x', 'text', 'ASC');
		expect(a).toEqual({ column: 'x', dir: 'asc' });
		const b = nextSort(a, 'x', 'text', 'ASC');
		expect(b).toEqual({ column: 'x', dir: 'desc' });
		expect(nextSort(b, 'x', 'text', 'ASC')).toBeNull();
	});
	it('restarts on another column', () => {
		expect(nextSort({ column: 'x', dir: 'desc' }, 'y', 'text', 'ASC')).toEqual({
			column: 'y',
			dir: 'asc'
		});
	});
	it('SMART starts temporal columns descending, DESC always', () => {
		expect(nextSort(null, 'd', 'temporal', 'SMART')?.dir).toBe('desc');
		expect(nextSort(null, 'n', 'integer', 'SMART')?.dir).toBe('asc');
		expect(nextSort(null, 'n', 'integer', 'DESC')?.dir).toBe('desc');
	});
});

describe('pagination', () => {
	it('computes the first page', () => {
		expect(paginate(0, 25, 60)).toMatchObject({
			pos: 0,
			page: 1,
			pages: 3,
			from: 1,
			to: 25,
			prevPos: null,
			nextPos: 25,
			lastPos: 50
		});
	});
	it('computes a partial last page', () => {
		expect(paginate(50, 25, 60)).toMatchObject({ from: 51, to: 60, nextPos: null, prevPos: 25 });
	});
	it('snaps and clamps pos', () => {
		expect(paginate(30, 25, 60).pos).toBe(25);
		expect(paginate(9999, 25, 60).pos).toBe(50);
		expect(paginate(-5, 25, 60).pos).toBe(0);
	});
	it('handles an empty result', () => {
		expect(paginate(0, 25, 0)).toMatchObject({ pages: 1, from: 0, to: 0, nextPos: null });
	});
	it('parses rows per page', () => {
		expect(parseRows('50', 25)).toBe(50);
		expect(parseRows('all', 25)).toBe('all');
		expect(parseRows('abc', 25)).toBe(25);
		expect(parseRows('0', 25)).toBe(25);
		expect(parseRows('999999', 25)).toBe(25);
		expect(parseRows(null, 100)).toBe(100);
	});
	it('offers sizes including MaxRows, and caps show all', () => {
		expect(rowsOptions(30)).toEqual([25, 30, 50, 100, 250, 500]);
		expect(rowsOptions(50)).toEqual([25, 50, 100, 250, 500]);
		expect(pageSize('all')).toBe(5000);
		expect(pageSize(50)).toBe(50);
		expect(canShowAll(400, false)).toBe(true);
		expect(canShowAll(4000, false)).toBe(false);
		expect(canShowAll(4000, true)).toBe(true);
	});
});

describe('columnKind', () => {
	it.each([
		['int(11) unsigned', 'integer'],
		['bigint', 'integer'],
		['decimal(20,6)', 'decimal'],
		['float', 'real'],
		['double', 'real'],
		['bit(8)', 'bit'],
		['blob', 'binary'],
		['varbinary(64)', 'binary'],
		['point', 'geometry'],
		['json', 'json'],
		['datetime(3)', 'temporal'],
		["enum('a','b')", 'enum'],
		["set('a')", 'set'],
		['varchar(255)', 'text'],
		['longtext', 'text']
	])('%s -> %s', (type, kind) => {
		expect(columnKind(type)).toBe(kind);
	});
	it('parses enum values', () => {
		expect(parseEnumValues("enum('a','it''s','c,d')")).toEqual(['a', "it's", 'c,d']);
		expect(parseEnumValues('int')).toEqual([]);
	});
});

describe('pageChoices', () => {
	it('lists every page for small results', () => {
		expect(pageChoices(3, 1)).toEqual([1, 2, 3]);
	});
	it('thins out huge page counts but keeps the neighbourhood', () => {
		const choices = pageChoices(1000, 500);
		expect(choices.length).toBeLessThan(120);
		expect(choices).toContain(1);
		expect(choices).toContain(1000);
		expect(choices).toContain(500);
		expect(choices).toContain(510);
	});
});
