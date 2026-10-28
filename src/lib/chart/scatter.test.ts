import { describe, expect, it } from 'vitest';
import {
	axisKindForType,
	buildAxis,
	extent,
	formatTime,
	linearTicks,
	niceStep,
	parseDateTime,
	scale,
	timeTicks,
	toAxisData
} from './scatter.ts';

describe('axisKindForType', () => {
	it('maps column types to axis kinds', () => {
		expect(axisKindForType('int(11)')).toBe('linear');
		expect(axisKindForType('decimal(8,2)')).toBe('linear');
		expect(axisKindForType('year')).toBe('linear');
		expect(axisKindForType('datetime')).toBe('time');
		expect(axisKindForType('date')).toBe('time');
		expect(axisKindForType('varchar(20)')).toBe('category');
		expect(axisKindForType("enum('a','b')")).toBe('category');
	});
});

describe('toAxisData', () => {
	it('parses numbers and dates, null for unusable values', () => {
		expect(toAxisData('linear', ['1', '2.5', null, 'x', '']).values).toEqual([
			1,
			2.5,
			null,
			null,
			null
		]);
		expect(toAxisData('time', ['1970-01-02', '1970-01-01 00:00:01.500']).values).toEqual([
			86400000, 1500
		]);
		expect(parseDateTime('nope')).toBeNull();
	});
	it('indexes sorted categories', () => {
		const d = toAxisData('category', ['b', 'a', 'b', null]);
		expect(d.categories).toEqual(['a', 'b']);
		expect(d.values).toEqual([1, 0, 1, null]);
	});
});

describe('ticks', () => {
	it('niceStep picks 1, 2, 5 multiples', () => {
		expect(niceStep(10, 5)).toBe(2);
		expect(niceStep(100, 4)).toBe(20);
		expect(niceStep(7, 7)).toBe(1);
		expect(niceStep(1.2, 6)).toBe(0.2);
	});
	it('linearTicks stay inside the range and are round', () => {
		expect(linearTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
		expect(linearTicks(0.05, 0.95, 4)).toEqual([0.2, 0.4, 0.6, 0.8]);
		expect(linearTicks(-3, 3, 6)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
		expect(linearTicks(5, 5)).toEqual([5]);
	});
	it('timeTicks use calendar friendly steps', () => {
		const day = 86400000;
		const ticks = timeTicks(0, 10 * day, 5);
		expect(ticks.every((t) => t % day === 0)).toBe(true);
		expect(ticks.length).toBeGreaterThanOrEqual(3);
	});
	it('formatTime adapts to the span', () => {
		const t = Date.UTC(1969, 2, 1, 13, 5);
		expect(formatTime(t, 20 * 365 * 86400000)).toBe('1969');
		expect(formatTime(t, 200 * 86400000)).toBe('1969-03');
		expect(formatTime(t, 10 * 86400000)).toBe('1969-03-01');
		expect(formatTime(t, 3600000)).toBe('1969-03-01 13:05');
	});
});

describe('axes and scales', () => {
	it('extent handles empty and degenerate input', () => {
		expect(extent([])).toEqual([0, 1]);
		expect(extent([null, 3, 1, 2])).toEqual([1, 3]);
		expect(extent([4, 4])[0]).toBeLessThan(4);
		expect(extent([0, 0])).toEqual([-1, 1]);
	});
	it('buildAxis pads the domain and labels ticks', () => {
		const a = buildAxis(toAxisData('linear', ['0', '10']));
		expect(a.domain[0]).toBeLessThan(0);
		expect(a.domain[1]).toBeGreaterThan(10);
		expect(a.ticks.map((t) => t.label)).toEqual(['0', '2', '4', '6', '8', '10']);
		const c = buildAxis(toAxisData('category', ['x', 'y']));
		expect(c.ticks.map((t) => t.label)).toEqual(['x', 'y']);
		expect(c.domain).toEqual([-0.5, 1.5]);
		const t = buildAxis(toAxisData('time', ['1961-01-01', '1974-05-01']));
		expect(t.kind).toBe('time');
		expect(t.ticks.length).toBeGreaterThan(2);
	});
	it('scale maps the domain onto the range (and inverted ranges for y)', () => {
		const s = scale([0, 10], 0, 100);
		expect(s(0)).toBe(0);
		expect(s(5)).toBe(50);
		expect(scale([0, 10], 100, 0)(2)).toBe(80);
	});
});
