/**
 * Pure helpers of the zoom-search scatter chart: axis kinds per column type, value conversion,
 * "nice" tick generation and linear scales. No DOM, no Svelte.
 */
import { baseColumnType, getTypeClass } from '#lib/sql/table-operators.ts';

export type AxisKind = 'linear' | 'time' | 'category';

/** Axis kind for a column type: numbers and YEAR are linear, dates/datetimes a time axis. */
export function axisKindForType(type: string): AxisKind {
	const base = baseColumnType(type).toLowerCase();
	if (base === 'year') return 'linear';
	if (base === 'date' || base === 'datetime' || base === 'timestamp') return 'time';
	const cls = getTypeClass(base);
	if (cls === 'NUMBER' && base !== 'bit') return 'linear';
	return 'category';
}

export interface AxisData {
	kind: AxisKind;
	/** One entry per input value; null where the value is missing or not usable. */
	values: (number | null)[];
	/** Sorted distinct labels of a category axis (value = index). */
	categories: string[];
}

/** Parse `YYYY-MM-DD[ HH:MM:SS[.fff]]` as UTC milliseconds. */
export function parseDateTime(text: string): number | null {
	const m = text.match(
		/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/
	);
	if (!m) return null;
	const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
	const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), ms);
	return Number.isNaN(t) ? null : t;
}

/** Convert raw cell strings to axis numbers for `kind`. */
export function toAxisData(kind: AxisKind, raw: readonly (string | null)[]): AxisData {
	if (kind === 'category') {
		const categories = [...new Set(raw.filter((v): v is string => v !== null))].sort((a, b) =>
			a.localeCompare(b)
		);
		const index = new Map(categories.map((c, i) => [c, i]));
		return { kind, categories, values: raw.map((v) => (v === null ? null : index.get(v)!)) };
	}
	const values = raw.map((v) => {
		if (v === null || v === '') return null;
		if (kind === 'time') return parseDateTime(v);
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	});
	return { kind, categories: [], values };
}

/** [min, max] of the non-null values; a degenerate range is widened so scales never divide by 0. */
export function extent(values: readonly (number | null)[]): [number, number] {
	let min = Infinity;
	let max = -Infinity;
	for (const v of values) {
		if (v === null) continue;
		if (v < min) min = v;
		if (v > max) max = v;
	}
	if (min === Infinity) return [0, 1];
	if (min === max)
		return min === 0 ? [-1, 1] : [min - Math.abs(min) * 0.1, max + Math.abs(max) * 0.1];
	return [min, max];
}

/** "Nice" step (1, 2, 5 x 10^k) giving about `count` intervals over `span`. */
export function niceStep(span: number, count: number): number {
	const raw = span / Math.max(count, 1);
	const pow = Math.pow(10, Math.floor(Math.log10(raw)));
	const f = raw / pow;
	return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
}

/** Round-number ticks inside [min, max] (about `count` of them). */
export function linearTicks(min: number, max: number, count = 6): number[] {
	if (!(max > min)) return [min];
	const step = niceStep(max - min, count);
	const first = Math.ceil(min / step - 1e-9) * step;
	const ticks: number[] = [];
	for (let t = first, i = 0; t <= max + step * 1e-9 && i < 1000; t = first + ++i * step) {
		// Avoid 0.30000000000000004: snap to the step's precision.
		const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
		ticks.push(Number(t.toFixed(Math.min(decimals, 12))));
	}
	return ticks;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TIME_STEPS = [
	SECOND,
	5 * SECOND,
	15 * SECOND,
	30 * SECOND,
	MINUTE,
	5 * MINUTE,
	15 * MINUTE,
	30 * MINUTE,
	HOUR,
	3 * HOUR,
	6 * HOUR,
	12 * HOUR,
	DAY,
	2 * DAY,
	7 * DAY,
	14 * DAY,
	30 * DAY,
	91 * DAY,
	182 * DAY,
	365 * DAY,
	2 * 365 * DAY,
	5 * 365 * DAY,
	10 * 365 * DAY,
	20 * 365 * DAY,
	50 * 365 * DAY,
	100 * 365 * DAY
];

/** Ticks of a time axis (UTC milliseconds), multiples of a calendar-friendly step. */
export function timeTicks(min: number, max: number, count = 6): number[] {
	if (!(max > min)) return [min];
	const target = (max - min) / count;
	const step = TIME_STEPS.find((s) => s >= target * 0.7) ?? niceStep(max - min, count);
	const ticks: number[] = [];
	for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
	return ticks;
}

const pad = (n: number, len = 2): string => String(n).padStart(len, '0');

/** Format a UTC millisecond tick with the precision the visible span needs. */
export function formatTime(ms: number, span: number): string {
	const d = new Date(ms);
	const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
	if (span >= 2 * 365 * DAY) return pad(d.getUTCFullYear(), 4);
	if (span >= 60 * DAY) return date.slice(0, 7);
	if (span >= 2 * DAY) return date;
	const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
	return span < 2 * MINUTE ? `${time}:${pad(d.getUTCSeconds())}` : `${date} ${time}`;
}

export function formatNumber(n: number): string {
	if (Math.abs(n) >= 1e9 || (n !== 0 && Math.abs(n) < 1e-4)) return n.toExponential(2);
	return String(Number(n.toPrecision(10)));
}

export interface Tick {
	value: number;
	label: string;
}

export interface Axis {
	kind: AxisKind;
	domain: [number, number];
	ticks: Tick[];
}

/** Build the domain and ticks of an axis from its converted data. */
export function buildAxis(data: AxisData): Axis {
	if (data.kind === 'category') {
		const n = data.categories.length;
		return {
			kind: 'category',
			domain: [-0.5, Math.max(n - 1, 0) + 0.5],
			ticks: data.categories.map((label, i) => ({ value: i, label }))
		};
	}
	const [min, max] = extent(data.values);
	const pad = (max - min) * 0.04;
	const domain: [number, number] = [min - pad, max + pad];
	if (data.kind === 'time') {
		const span = domain[1] - domain[0];
		return {
			kind: 'time',
			domain,
			ticks: timeTicks(domain[0], domain[1]).map((value) => ({
				value,
				label: formatTime(value, span)
			}))
		};
	}
	return {
		kind: 'linear',
		domain,
		ticks: linearTicks(domain[0], domain[1]).map((value) => ({ value, label: formatNumber(value) }))
	};
}

/** Linear scale from the domain to [r0, r1]. */
export function scale(domain: [number, number], r0: number, r1: number): (v: number) => number {
	const span = domain[1] - domain[0] || 1;
	return (v) => r0 + ((v - domain[0]) / span) * (r1 - r0);
}

export interface ScatterPoint {
	/** Identifier handed back to `onselect`. */
	id: number;
	x: number;
	y: number;
	/** Tooltip lines. */
	tip: { name: string; value: string }[];
}
