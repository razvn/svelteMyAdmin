import { describe, expect, it } from 'vitest';
import {
	buildChart,
	linePath,
	paletteIndex,
	slicePath,
	splinePath,
	valueAxis,
	type ChartShape
} from './builders.ts';

const of = <K extends ChartShape['kind']>(shapes: ChartShape[], kind: K) =>
	shapes.filter((s): s is Extract<ChartShape, { kind: K }> => s.kind === kind);

describe('valueAxis', () => {
	it('snaps to round ticks and keeps zero for bars', () => {
		const a = valueAxis(3, 97, true);
		expect(a.domain).toEqual([0, 100]);
		expect(a.ticks[0]).toBe(0);
		expect(a.ticks.at(-1)).toBe(100);
	});
	it('widens a degenerate range', () => {
		const a = valueAxis(5, 5, false);
		expect(a.domain[0]).toBeLessThan(5);
		expect(a.domain[1]).toBeGreaterThan(5);
	});
});

describe('paths', () => {
	it('breaks lines at missing values', () => {
		expect(linePath([[0, 0], [1, 1], null, [2, 2]])).toBe('M0,0L1,1M2,2');
	});
	it('builds a spline through all points', () => {
		const d = splinePath([
			[0, 0],
			[10, 10],
			[20, 0]
		]);
		expect(d.startsWith('M0,0C')).toBe(true);
		expect(d.match(/C/g)).toHaveLength(2);
		expect(d.endsWith('20,0')).toBe(true);
	});
	it('draws a full circle for a single slice', () => {
		expect(slicePath(50, 50, 10, 0, Math.PI * 2)).toContain('A10,10 0 1 1');
	});
	it('cycles the palette', () => {
		expect([0, 4, 5].map(paletteIndex)).toEqual([1, 5, 1]);
	});
});

describe('buildChart', () => {
	const xValues = ['a', 'b', 'c'];
	const series = [
		{ name: 'price', values: ['10', '20', '5'] },
		{ name: 'qty', values: ['1', null, '3'] }
	];

	it('is empty without data', () => {
		expect(buildChart({ type: 'column', xValues: [], series }).empty).toBe(true);
		expect(buildChart({ type: 'column', xValues, series: [] }).empty).toBe(true);
	});

	it('draws grouped columns, skipping NULL values', () => {
		const m = buildChart({ type: 'column', xValues, series });
		const rects = of(m.shapes, 'rect');
		expect(rects).toHaveLength(5);
		expect(m.xTicks.map((t) => t.label)).toEqual(xValues);
		const price = rects.filter((r) => r.series === 0);
		// bigger value, taller bar, same baseline
		expect(price[1].h).toBeGreaterThan(price[0].h);
		expect(price[0].y + price[0].h).toBeCloseTo(price[1].y + price[1].h);
		expect(price[0].tip).toBe('a - price: 10');
	});

	it('lays bars out horizontally', () => {
		const m = buildChart({ type: 'bar', xValues, series: [series[0]], xLabel: 'X', yLabel: 'Y' });
		const rects = of(m.shapes, 'rect');
		expect(rects[1].w).toBeGreaterThan(rects[0].w);
		expect(m.yTicks.map((t) => t.label)).toEqual(xValues);
		expect(m.gridX).toBe(true);
		expect(m.leftLabel).toBe('X');
		expect(m.bottomLabel).toBe('Y');
	});

	it('draws a line, an area and points per series', () => {
		const line = buildChart({ type: 'line', xValues, series });
		expect(of(line.shapes, 'line')).toHaveLength(2);
		expect(of(line.shapes, 'point')).toHaveLength(5);
		const area = buildChart({ type: 'area', xValues, series: [series[0]] });
		expect(of(area.shapes, 'area')[0].d.endsWith('Z')).toBe(true);
		const spline = buildChart({ type: 'spline', xValues, series: [series[0]] });
		expect(of(spline.shapes, 'line')[0].d).toContain('C');
	});

	it('splits a pie into proportional slices of the first series', () => {
		const m = buildChart({
			type: 'pie',
			xValues: ['x', 'y', 'z'],
			series: [{ name: 's', values: ['1', '3', '-2'] }]
		});
		const slices = of(m.shapes, 'slice');
		expect(slices.map((s) => s.tip)).toEqual(['x: 1 (25.0%)', 'y: 3 (75.0%)']);
		expect(m.legend.map((l) => l.name)).toEqual(['x', 'y']);
		expect(
			buildChart({ type: 'pie', xValues: ['x'], series: [{ name: 's', values: ['0'] }] }).empty
		).toBe(true);
	});

	it('orders a timeline by time', () => {
		const m = buildChart({
			type: 'timeline',
			xKind: 'time',
			xValues: ['2024-03-01', '2024-01-01', '2024-02-01'],
			series: [{ name: 'v', values: ['3', '1', '2'] }]
		});
		const pts = of(m.shapes, 'point');
		expect(pts).toHaveLength(3);
		expect(of(m.shapes, 'line')[0].d.startsWith('M')).toBe(true);
	});

	it('plots a numeric scatter without lines', () => {
		const m = buildChart({
			type: 'scatter',
			xKind: 'linear',
			xValues: ['1', '2', 'x'],
			series: [{ name: 'v', values: ['3', '4', '5'] }]
		});
		expect(of(m.shapes, 'point')).toHaveLength(2);
		expect(of(m.shapes, 'line')).toHaveLength(0);
	});
});
