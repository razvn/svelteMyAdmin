import { describe, expect, it } from 'vitest';
import {
	emptyStats,
	isSystemSchema,
	paginate,
	parseGrants,
	parseQuery,
	sortDatabases,
	sumStats,
	type DatabaseRow
} from './databases';

const row = (name: string, collation: string, rows: number, data = 0): DatabaseRow => ({
	name,
	collation,
	isSystemSchema: false,
	isPmadb: false,
	stats: { ...emptyStats(), SCHEMA_TABLE_ROWS: rows, SCHEMA_DATA_LENGTH: data }
});

describe('databases helpers', () => {
	const rows = [
		row('b', 'utf8mb4_bin', 5, 10),
		row('a10', 'latin1_swedish_ci', 50),
		row('a2', 'x', 1)
	];

	it('sorts by name naturally and by stats, both directions', () => {
		expect(sortDatabases(rows, 'SCHEMA_NAME', 'asc').map((r) => r.name)).toEqual([
			'a2',
			'a10',
			'b'
		]);
		expect(sortDatabases(rows, 'SCHEMA_TABLE_ROWS', 'desc').map((r) => r.name)).toEqual([
			'a10',
			'b',
			'a2'
		]);
		expect(sortDatabases(rows, 'DEFAULT_COLLATION_NAME', 'asc')[0].name).toBe('a10');
	});

	it('sums statistics', () => {
		const t = sumStats(rows);
		expect(t.SCHEMA_TABLE_ROWS).toBe(56);
		expect(t.SCHEMA_DATA_LENGTH).toBe(10);
		expect(sumStats([{ stats: null }])).toEqual(emptyStats());
	});

	it('paginates', () => {
		expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
		expect(paginate([1, 2, 3], 0, 0)).toEqual([1, 2, 3]);
	});

	it('detects system schemas', () => {
		for (const n of ['information_schema', 'PERFORMANCE_SCHEMA', 'mysql', 'sys']) {
			expect(isSystemSchema(n)).toBe(true);
		}
		expect(isSystemSchema('sma_test')).toBe(false);
	});

	it('parses query params defensively', () => {
		const q = parseQuery(new URLSearchParams('statistics=1&pos=-3&sort_by=evil&sort_order=DESC'));
		expect(q).toEqual({ statistics: true, pos: 0, sort_by: 'SCHEMA_NAME', sort_order: 'desc' });
		expect(parseQuery(new URLSearchParams(''))).toEqual({
			statistics: false,
			pos: 0,
			sort_by: 'SCHEMA_NAME',
			sort_order: 'asc'
		});
	});

	it('parses grants', () => {
		expect(parseGrants(['GRANT ALL PRIVILEGES ON *.* TO `root`@`%` WITH GRANT OPTION'])).toEqual({
			isSuperUser: true,
			canCreateDb: true
		});
		expect(
			parseGrants(['GRANT USAGE ON *.* TO `u`@`%`', 'GRANT SELECT ON `x`.* TO `u`@`%`'])
		).toEqual({ isSuperUser: false, canCreateDb: false });
		expect(parseGrants(['GRANT SELECT, CREATE ON `app%`.* TO `u`@`%`']).canCreateDb).toBe(true);
	});
});
