/**
 * Pure chart builders for "Display chart" (Controllers/Table/ChartController.php, js/src/table/chart.js).
 * `buildChart` turns result columns into a geometry model (rectangles, paths, slices, points) in SVG
 * user units; `chart.svelte` only renders it. Series colours are indices 1..5 of the `--chart-N` tokens.
 */
import { buildAxis, linearTicks, niceStep, scale, toAxisData, type AxisKind } from './scatter.ts';

export const CHART_TYPES = [
	{ value: 'bar', label: 'Bar' },
	{ value: 'column', label: 'Column' },
	{ value: 'line', label: 'Line' },
	{ value: 'spline', label: 'Spline' },
	{ value: 'area', label: 'Area' },
	{ value: 'pie', label: 'Pie' },
	{ value: 'timeline', label: 'Timeline' },
	{ value: 'scatter', label: 'Scatter' }
] as const;

export type ChartType = (typeof CHART_TYPES)[number]['value'];

export interface ChartSeriesInput {
	name: string;
	/** One raw cell per row (null = NULL). */
	values: (string | null)[];
}

export interface ChartSpec {
	type: ChartType;
	/** Raw cells of the X column, one per row. */
	xValues: (string | null)[];
	/** Needed by `timeline` and `scatter`; derived from the X column type by `axisKindForType`. */
	xKind?: AxisKind;
	series: ChartSeriesInput[];
	title?: string;
	xLabel?: string;
	yLabel?: string;
	width?: number;
	height?: number;
}

export interface ChartTick {
	/** Position along the axis in SVG units. */
	pos: number;
	label: string;
}

export type ChartShape =
	| { kind: 'rect'; x: number; y: number; w: number; h: number; series: number; tip: string }
	| { kind: 'line'; d: string; series: number }
	| { kind: 'area'; d: string; series: number }
	| { kind: 'point'; cx: number; cy: number; series: number; tip: string }
	| {
			kind: 'slice';
			d: string;
			series: number;
			tip: string;
			label: string;
			lx: number;
			ly: number;
	  };

export interface ChartModel {
	type: ChartType;
	width: number;
	height: number;
	title: string;
	/** Axis captions: under the plot and left of it. */
	bottomLabel: string;
	leftLabel: string;
	plot: { x0: number; y0: number; x1: number; y1: number };
	xTicks: ChartTick[];
	yTicks: ChartTick[];
	gridX: boolean;
	gridY: boolean;
	shapes: ChartShape[];
	legend: { name: string; series: number }[];
	/** Nothing usable to draw. */
	empty: boolean;
}

export const PALETTE_SIZE = 5;
/** Palette index (1..5) of series `i`. */
export const paletteIndex = (i: number): number => (i % PALETTE_SIZE) + 1;

const toNumber = (v: string | null): number | null => {
	if (v === null || v.trim() === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

export function formatValue(n: number): string {
	return String(Number(n.toPrecision(10)));
}

/** Value axis range: always contains `lo`/`hi`, snapped to round ticks. */
export function valueAxis(
	lo: number,
	hi: number,
	includeZero: boolean
): { domain: [number, number]; ticks: number[] } {
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { domain: [0, 1], ticks: [0, 1] };
	if (includeZero) {
		lo = Math.min(lo, 0);
		hi = Math.max(hi, 0);
	}
	if (hi === lo) {
		lo -= 1;
		hi += 1;
	}
	const step = niceStep(hi - lo, 6);
	const min = Math.floor(lo / step + 1e-9) * step;
	const max = Math.ceil(hi / step - 1e-9) * step;
	return { domain: [min, max], ticks: linearTicks(min, max, 6) };
}

/** Catmull-Rom spline through `pts` as a cubic Bezier path. */
export function splinePath(pts: readonly [number, number][]): string {
	if (pts.length === 0) return '';
	let d = `M${fmt(pts[0][0])},${fmt(pts[0][1])}`;
	if (pts.length === 1) return d;
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[i - 1] ?? pts[i];
		const p1 = pts[i];
		const p2 = pts[i + 1];
		const p3 = pts[i + 2] ?? p2;
		const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
		const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
		d += `C${fmt(c1[0])},${fmt(c1[1])} ${fmt(c2[0])},${fmt(c2[1])} ${fmt(p2[0])},${fmt(p2[1])}`;
	}
	return d;
}

/** Straight path through `pts`, broken at nulls (missing values). */
export function linePath(pts: readonly ([number, number] | null)[]): string {
	let d = '';
	let open = false;
	for (const p of pts) {
		if (!p) {
			open = false;
			continue;
		}
		d += `${open ? 'L' : 'M'}${fmt(p[0])},${fmt(p[1])}`;
		open = true;
	}
	return d;
}

/** Pie slice path from angle `a0` to `a1` (radians, 0 = 12 o'clock, clockwise). */
export function slicePath(cx: number, cy: number, r: number, a0: number, a1: number): string {
	if (a1 - a0 >= Math.PI * 2 - 1e-9) {
		return `M${fmt(cx)},${fmt(cy - r)}A${fmt(r)},${fmt(r)} 0 1 1 ${fmt(cx)},${fmt(cy + r)}A${fmt(r)},${fmt(r)} 0 1 1 ${fmt(cx)},${fmt(cy - r)}Z`;
	}
	const p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
	const [x0, y0] = p(a0);
	const [x1, y1] = p(a1);
	const large = a1 - a0 > Math.PI ? 1 : 0;
	return `M${fmt(cx)},${fmt(cy)}L${fmt(x0)},${fmt(y0)}A${fmt(r)},${fmt(r)} 0 ${large} 1 ${fmt(x1)},${fmt(y1)}Z`;
}

const CATEGORY_TYPES: ChartType[] = ['bar', 'column', 'line', 'spline', 'area'];

export function buildChart(spec: ChartSpec): ChartModel {
	const width = spec.width ?? 800;
	const height = spec.height ?? 480;
	const title = spec.title ?? '';
	const xLabel = spec.xLabel ?? '';
	const yLabel = spec.yLabel ?? '';
	const top = title ? 44 : 16;
	const base: ChartModel = {
		type: spec.type,
		width,
		height,
		title,
		bottomLabel: xLabel,
		leftLabel: yLabel,
		plot: { x0: 72, y0: top, x1: width - 24, y1: height - 56 },
		xTicks: [],
		yTicks: [],
		gridX: false,
		gridY: false,
		shapes: [],
		legend: spec.series.map((s, i) => ({ name: s.name, series: i })),
		empty: false
	};
	if (spec.xValues.length === 0 || spec.series.length === 0) return { ...base, empty: true };

	if (spec.type === 'pie') return buildPie(spec, base);
	if (spec.type === 'scatter' || spec.type === 'timeline') return buildXY(spec, base);
	if (CATEGORY_TYPES.includes(spec.type)) return buildCategory(spec, base);
	return { ...base, empty: true };
}

// ---- pie ---------------------------------------------------------------------------------------

function buildPie(spec: ChartSpec, base: ChartModel): ChartModel {
	const values = spec.series[0].values.map((v) => toNumber(v));
	const slices = values
		.map((v, i) => ({ v: v !== null && v > 0 ? v : 0, label: spec.xValues[i] ?? 'NULL' }))
		.filter((s) => s.v > 0);
	const total = slices.reduce((sum, s) => sum + s.v, 0);
	if (total <= 0) return { ...base, empty: true };
	const cx = base.width / 2;
	const cy = (base.plot.y0 + base.plot.y1) / 2;
	const r = Math.min((base.plot.y1 - base.plot.y0) / 2, (base.plot.x1 - base.plot.x0) / 2) - 8;
	let angle = 0;
	const shapes: ChartShape[] = slices.map((s, i) => {
		const sweep = (s.v / total) * Math.PI * 2;
		const mid = angle + sweep / 2;
		const shape: ChartShape = {
			kind: 'slice',
			d: slicePath(cx, cy, r, angle, angle + sweep),
			series: i,
			tip: `${s.label}: ${formatValue(s.v)} (${((s.v / total) * 100).toFixed(1)}%)`,
			label: s.label,
			lx: cx + r * 0.62 * Math.sin(mid),
			ly: cy - r * 0.62 * Math.cos(mid)
		};
		angle += sweep;
		return shape;
	});
	return {
		...base,
		shapes,
		bottomLabel: '',
		leftLabel: '',
		legend: slices.map((s, i) => ({ name: s.label, series: i }))
	};
}

// ---- bar / column / line / spline / area (category X axis) -------------------------------------

function buildCategory(spec: ChartSpec, base: ChartModel): ChartModel {
	const { x0, y0, x1, y1 } = base.plot;
	const n = spec.xValues.length;
	const horizontal = spec.type === 'bar';
	const series = spec.series.map((s) => s.values.map((v) => toNumber(v)));
	const all = series.flat().filter((v): v is number => v !== null);
	if (all.length === 0) return { ...base, empty: true };
	const bars = spec.type === 'bar' || spec.type === 'column';
	const { domain, ticks } = valueAxis(
		Math.min(...all),
		Math.max(...all),
		bars || spec.type === 'area'
	);

	const cats = spec.xValues.map((v) => v ?? 'NULL');
	const catStart = horizontal ? y0 : x0;
	const catEnd = horizontal ? y1 : x1;
	const band = (catEnd - catStart) / n;
	const catPos = (i: number) => catStart + (i + 0.5) * band;
	const val = horizontal ? scale(domain, x0, x1) : scale(domain, y1, y0);
	const catTicks: ChartTick[] = cats.map((label, i) => ({ pos: catPos(i), label }));
	const valTicks: ChartTick[] = ticks.map((t) => ({ pos: val(t), label: formatValue(t) }));

	const shapes: ChartShape[] = [];
	const k = series.length;
	if (bars) {
		const group = band * 0.8;
		const w = group / k;
		const zero = val(Math.min(Math.max(0, domain[0]), domain[1]));
		series.forEach((vals, s) => {
			vals.forEach((v, i) => {
				if (v === null) return;
				const start = catPos(i) - group / 2 + s * w;
				const end = val(v);
				const tip = `${cats[i]} - ${spec.series[s].name}: ${formatValue(v)}`;
				shapes.push(
					horizontal
						? {
								kind: 'rect',
								x: Math.min(zero, end),
								y: start,
								w: Math.abs(end - zero),
								h: w,
								series: s,
								tip
							}
						: {
								kind: 'rect',
								x: start,
								y: Math.min(zero, end),
								w,
								h: Math.abs(end - zero),
								series: s,
								tip
							}
				);
			});
		});
	} else {
		const baseline = val(Math.min(Math.max(0, domain[0]), domain[1]));
		series.forEach((vals, s) => {
			const pts = vals.map((v, i) =>
				v === null ? null : ([catPos(i), val(v)] as [number, number])
			);
			const solid = pts.filter((p): p is [number, number] => p !== null);
			if (solid.length === 0) return;
			const curve = spec.type === 'spline';
			const d = curve ? splinePath(solid) : linePath(pts);
			if (spec.type === 'area') {
				const first = solid[0];
				const last = solid[solid.length - 1];
				shapes.push({
					kind: 'area',
					d: `${linePath(solid)}L${fmt(last[0])},${fmt(baseline)}L${fmt(first[0])},${fmt(baseline)}Z`,
					series: s
				});
			}
			shapes.push({ kind: 'line', d, series: s });
			vals.forEach((v, i) => {
				if (v === null) return;
				shapes.push({
					kind: 'point',
					cx: catPos(i),
					cy: val(v),
					series: s,
					tip: `${cats[i]} - ${spec.series[s].name}: ${formatValue(v)}`
				});
			});
		});
	}

	return horizontal
		? {
				...base,
				xTicks: valTicks,
				yTicks: catTicks,
				gridX: true,
				shapes,
				bottomLabel: spec.yLabel ?? '',
				leftLabel: spec.xLabel ?? ''
			}
		: { ...base, xTicks: catTicks, yTicks: valTicks, gridY: true, shapes };
}

// ---- timeline / scatter (numeric or time X axis) ----------------------------------------------

function buildXY(spec: ChartSpec, base: ChartModel): ChartModel {
	const { x0, y0, x1, y1 } = base.plot;
	const kind: AxisKind = spec.xKind ?? (spec.type === 'timeline' ? 'time' : 'linear');
	const xData = toAxisData(kind, spec.xValues);
	const xAxis = buildAxis(xData);
	const sx = scale(xAxis.domain, x0, x1);
	const series = spec.series.map((s) => s.values.map((v) => toNumber(v)));
	const all = series.flat().filter((v): v is number => v !== null);
	if (all.length === 0 || xData.values.every((v) => v === null)) return { ...base, empty: true };
	const { domain, ticks } = valueAxis(Math.min(...all), Math.max(...all), false);
	const sy = scale(domain, y1, y0);
	const xLabelOf = (i: number): string =>
		kind === 'category' ? (spec.xValues[i] ?? 'NULL') : (spec.xValues[i] ?? '');

	const shapes: ChartShape[] = [];
	series.forEach((vals, s) => {
		const pts = vals
			.map((v, i) => ({ v, x: xData.values[i], i }))
			.filter((p): p is { v: number; x: number; i: number } => p.v !== null && p.x !== null);
		if (spec.type === 'timeline') {
			pts.sort((a, b) => a.x - b.x);
			shapes.push({ kind: 'line', d: linePath(pts.map((p) => [sx(p.x), sy(p.v)])), series: s });
		}
		for (const p of pts) {
			shapes.push({
				kind: 'point',
				cx: sx(p.x),
				cy: sy(p.v),
				series: s,
				tip: `${xLabelOf(p.i)} - ${spec.series[s].name}: ${formatValue(p.v)}`
			});
		}
	});

	return {
		...base,
		xTicks: xAxis.ticks.map((t) => ({ pos: sx(t.value), label: t.label })),
		yTicks: ticks.map((t) => ({ pos: sy(t), label: formatValue(t) })),
		gridX: true,
		gridY: true,
		shapes
	};
}
