import { describe, expect, it } from 'vitest';
import { pieSlices, queryStats, usedQueries } from './queries';

describe('usedQueries', () => {
	it('keeps positive Com_ counters except Com_admin_commands', () => {
		expect(
			usedQueries({
				Com_select: '5',
				Com_insert: '0',
				Com_admin_commands: '9',
				Uptime: '100'
			})
		).toEqual({ Com_select: 5 });
	});
});

describe('queryStats', () => {
	it('computes totals, rates and percentages sorted by count', () => {
		const s = queryStats({ Com_select: 30, Com_insert_select: 70 }, 3600);
		expect(s.total).toBe(100);
		expect(s.perHour).toBe(100);
		expect(s.perMinute).toBeCloseTo(100 / 60);
		expect(s.perSecond).toBeCloseTo(100 / 3600);
		expect(s.queries.map((q) => q.name)).toEqual(['insert select', 'select']);
		expect(s.queries[0].percentage).toBe(70);
	});
	it('groups small slices into Other after 7 slices', () => {
		const used: Record<string, number> = {};
		for (let i = 0; i < 7; i++) used[`Com_big${i}`] = 1000;
		used.Com_tiny1 = 1;
		used.Com_tiny2 = 2;
		const s = queryStats(used, 100);
		expect(s.chart.at(-1)).toEqual({ name: 'Other', value: 3 });
		expect(s.chart).toHaveLength(8);
	});
	it('survives zero uptime and no queries', () => {
		expect(queryStats({}, 0)).toMatchObject({ total: 0, perHour: 0, queries: [], chart: [] });
	});
});

describe('pieSlices', () => {
	it('returns one path per slice', () => {
		const slices = pieSlices([
			{ name: 'a', value: 1 },
			{ name: 'b', value: 3 }
		]);
		expect(slices).toHaveLength(2);
		expect(slices[0].d.startsWith('M 0 0 L')).toBe(true);
		expect(pieSlices([])).toEqual([]);
	});
});
