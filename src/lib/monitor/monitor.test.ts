import { describe, expect, it } from 'vitest';
import {
	chartValues,
	emptyHistory,
	parseSample,
	pushSample,
	ratePerSecond,
	requiredPoints,
	seriesValue
} from './math.ts';
import {
	DEFAULT_SETTINGS,
	PRESETS,
	STORAGE_KEY,
	chartFromPreset,
	defaultCharts,
	loadSettings,
	newChartId,
	parseSettings,
	saveSettings
} from './presets.ts';
import {
	groupQueries,
	normalizeQuery,
	processGeneralLog,
	processSlowLog,
	statementType,
	timeToSeconds,
	type GeneralLogRow,
	type SlowLogRow
} from './log.ts';
import { SettingsSchema, type SeriesDef } from './types.ts';

const diffSeries = (name: string, divisor = 1): SeriesDef => ({
	label: name,
	points: [{ type: 'statusvar', name }],
	display: 'differential',
	divisor
});

describe('sample maths', () => {
	it('parses numeric strings and nulls', () => {
		expect(parseSample({ a: '12', b: null, c: 'x', d: 3 })).toEqual({
			a: 12,
			b: null,
			c: null,
			d: 3
		});
	});
	it('computes rates and ignores counter resets', () => {
		expect(ratePerSecond(100, 160, 5)).toBe(12);
		expect(ratePerSecond(100, 50, 5)).toBeNull();
		expect(ratePerSecond(1, 2, 0)).toBeNull();
	});
	it('differential series: first sample is null, then per second / divisor', () => {
		const s = diffSeries('Bytes_sent', 1024);
		const a = { 'statusvar:Bytes_sent': 0 };
		const b = { 'statusvar:Bytes_sent': 10240 };
		expect(seriesValue(s, null, a, 0)).toBeNull();
		expect(seriesValue(s, a, b, 5)).toBe(2);
	});
	it('absolute series ignore the previous sample', () => {
		const s: SeriesDef = { ...diffSeries('Threads_running'), display: 'absolute' };
		expect(seriesValue(s, null, { 'statusvar:Threads_running': 3 }, 0)).toBe(3);
	});
	it('missing variables give null', () => {
		expect(
			seriesValue(diffSeries('X'), { 'statusvar:X': null }, { 'statusvar:X': 1 }, 1)
		).toBeNull();
	});
	it('qce transform: hits / (selects + hits)', () => {
		const s = PRESETS.find((p) => p.key === 'qce')!.chart.series[0];
		const prev = { 'statusvar:Qcache_hits': 0, 'statusvar:Com_select': 0 };
		expect(
			seriesValue(s, prev, { 'statusvar:Qcache_hits': 30, 'statusvar:Com_select': 70 }, 10)
		).toBe(30);
		expect(
			seriesValue(s, prev, { 'statusvar:Qcache_hits': 0, 'statusvar:Com_select': 0 }, 10)
		).toBe(0);
	});
	it('qcu transform: 100 - free / size * 100', () => {
		const s = PRESETS.find((p) => p.key === 'qcu')!.chart.series[0];
		const cur = { 'statusvar:Qcache_free_memory': 25, 'servervar:query_cache_size': 100 };
		expect(seriesValue(s, null, cur, 0)).toBe(75);
		expect(seriesValue(s, null, { ...cur, 'servervar:query_cache_size': 0 }, 0)).toBe(0);
	});
	it('chartValues returns one value per series', () => {
		const traffic = chartFromPreset('traffic', 't')!;
		const prev = { 'statusvar:Bytes_sent': 0, 'statusvar:Bytes_received': 0 };
		const cur = { 'statusvar:Bytes_sent': 2048, 'statusvar:Bytes_received': 1024 };
		expect(chartValues(traffic, prev, cur, 1)).toEqual([2, 1]);
	});
	it('collects the distinct required points', () => {
		const pts = requiredPoints(defaultCharts());
		const names = pts.map((p) => `${p.type}:${p.name}`);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toContain('statusvar:Questions');
		expect(names).toContain('proc:processes');
	});
	it('keeps a rolling window', () => {
		let h = emptyHistory(chartFromPreset('traffic', 't')!);
		for (let i = 0; i < 5; i++) h = pushSample(h, i, [i, null], 3);
		expect(h.times).toEqual([2, 3, 4]);
		expect(h.values[0]).toEqual([2, 3, 4]);
		expect(h.values[1]).toEqual([null, null, null]);
	});
});

describe('settings', () => {
	it('defaults are valid and contain the documented charts', () => {
		expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
		expect(DEFAULT_SETTINGS.charts.map((c) => c.title)).toEqual([
			'Questions',
			'Connections / Processes',
			'Traffic',
			'InnoDB buffer pool',
			'Table locks',
			'Handler read'
		]);
	});
	it('every preset is a valid chart', () => {
		for (const p of PRESETS) expect(chartFromPreset(p.key, p.key)).not.toBeNull();
		expect(
			SettingsSchema.safeParse({
				...DEFAULT_SETTINGS,
				charts: PRESETS.map((p) => chartFromPreset(p.key, p.key))
			}).success
		).toBe(true);
	});
	it('falls back to defaults on corrupt or invalid data', () => {
		expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings(JSON.stringify({ charts: [], columns: 9, refresh: 5 }))).toEqual(
			DEFAULT_SETTINGS
		);
		expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
	it('rejects unsafe variable names', () => {
		const bad = {
			...DEFAULT_SETTINGS,
			charts: [{ ...DEFAULT_SETTINGS.charts[0], series: [{ ...diffSeries('a b; DROP') }] }]
		};
		expect(SettingsSchema.safeParse(bad).success).toBe(false);
	});
	it('round-trips through storage and survives a throwing storage', () => {
		const mem = new Map<string, string>();
		const storage = {
			getItem: (k: string) => mem.get(k) ?? null,
			setItem: (k: string, v: string) => void mem.set(k, v)
		};
		saveSettings(storage, { ...DEFAULT_SETTINGS, columns: 2, refresh: 10 });
		expect(mem.has(STORAGE_KEY)).toBe(true);
		expect(loadSettings(storage)).toMatchObject({ columns: 2, refresh: 10 });
		const throwing = {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			}
		};
		expect(() => saveSettings(throwing, DEFAULT_SETTINGS)).not.toThrow();
		expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
		expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});
	it('generates unique chart ids', () => {
		expect(newChartId(defaultCharts())).toBe('chart7');
		expect(newChartId([{ ...defaultCharts()[0], id: 'chart1' }])).toBe('chart2');
	});
});

describe('log analysis', () => {
	const slow = (sql: string, count = 1, time = '00:00:01'): SlowLogRow => ({
		start_time: '2025-01-01 00:00:00',
		user_host: 'root[root] @ localhost []',
		query_time: time,
		lock_time: '00:00:00',
		rows_sent: 1,
		rows_examined: 10,
		db: 'x',
		sql_text: sql,
		count
	});
	it('finds statement types', () => {
		expect(statementType('  SELECT 1')).toBe('select');
		expect(statementType('')).toBe('');
	});
	it('sums slow log entries by type and truncates long inserts', () => {
		const long = 'INSERT INTO t VALUES ' + "('x'),".repeat(100);
		const r = processSlowLog([slow('SELECT 1', 2), slow(long), slow('update t set a=1', 3)]);
		expect(r.sum).toEqual({ select: 2, insert: 1, update: 3, TOTAL: 6 });
		expect(r.numRows).toBe(3);
		expect(r.rows[1].sql_text).toMatch(/^INSERT INTO t VALUES .{0,200}\.\.\. \[\d/);
		expect(r.rows[1].sql_text.length).toBeLessThan(250);
	});
	const gen = (argument: string, count = 1): GeneralLogRow => ({
		event_time: '10:00:00',
		user_host: 'root',
		thread_id: 1,
		server_id: 1,
		argument,
		count
	});
	it('groups inserts per table when asked', () => {
		const rows = [
			gen('INSERT INTO `a` VALUES (1)'),
			gen('SELECT 1'),
			gen('INSERT INTO `a` VALUES (2)'),
			gen('INSERT INTO b VALUES (1)')
		];
		const grouped = processGeneralLog(rows, true);
		expect(grouped.rows.map((r) => r.count)).toEqual([2, 1, 1]);
		expect(grouped.rows[0].argument.endsWith('...')).toBe(true);
		expect(grouped.sum).toEqual({ insert: 3, select: 1, TOTAL: 4 });
		expect(processGeneralLog(rows, false).numRows).toBe(4);
	});
	it('normalises literals', () => {
		expect(normalizeQuery("SELECT * FROM t WHERE a = 5 AND b = 'x''y' AND c IN (1, 2, 3)")).toBe(
			'SELECT * FROM t WHERE a = ? AND b = ? AND c IN (?)'
		);
		expect(normalizeQuery('SELECT `t1`.a FROM t1')).toBe('SELECT `t1`.a FROM t1');
	});
	it('groups by query summing time and count', () => {
		expect(timeToSeconds('00:01:30.5')).toBe(90.5);
		const g = groupQueries(
			[
				{ sql: 'SELECT 1 WHERE a=1', count: 2, time: '00:00:02' },
				{ sql: 'SELECT 1 WHERE a=2', count: 1, time: '00:00:03' },
				{ sql: 'SELECT 2', count: 5, time: '00:00:01' }
			],
			true
		);
		expect(g[0]).toMatchObject({ query: 'SELECT ? WHERE a=?', count: 3, totalTime: 5, maxTime: 3 });
		expect(g).toHaveLength(2);
		expect(
			groupQueries(
				[
					{ sql: 'a', count: 1 },
					{ sql: 'a', count: 1 }
				],
				false
			)[0].count
		).toBe(2);
	});
});
