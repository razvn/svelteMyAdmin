/** Sample maths of the monitor: per second differences, divisors and the preset transforms. */
import { pointKey, type ChartDef, type RawSample, type SeriesDef } from './types.ts';

/** Parse the JSON response values (numeric strings) into numbers. */
export function parseSample(values: Record<string, string | number | null>): RawSample {
	const out: RawSample = {};
	for (const [k, v] of Object.entries(values)) {
		if (v === null || v === '') {
			out[k] = null;
			continue;
		}
		const n = Number(v);
		out[k] = Number.isFinite(n) ? n : null;
	}
	return out;
}

/** Change per second between two counters. null when the counter went backwards (FLUSH STATUS, restart). */
export function ratePerSecond(prev: number, cur: number, seconds: number): number | null {
	if (!(seconds > 0)) return null;
	const d = cur - prev;
	return d < 0 ? null : d / seconds;
}

/**
 * Value of one series for the sample `cur` taken `seconds` after `prev`.
 * Returns null when it cannot be computed (first differential sample, missing variable, counter reset).
 */
export function seriesValue(
	series: SeriesDef,
	prev: RawSample | null,
	cur: RawSample,
	seconds: number
): number | null {
	const get = (s: RawSample, i: number) => s[pointKey(series.points[i])] ?? null;
	const diff = (i: number): number | null => {
		const a = prev ? get(prev, i) : null;
		const b = get(cur, i);
		return a === null || b === null ? null : ratePerSecond(a, b, seconds);
	};
	let v: number | null;
	switch (series.transform) {
		case 'qce': {
			// Query cache hit rate: hits / (selects + hits) over the interval (points: Qcache_hits, Com_select).
			const hits = diff(0);
			const selects = diff(1);
			if (hits === null || selects === null) return null;
			const total = hits + selects;
			return total === 0 ? 0 : (hits / total) * 100;
		}
		case 'qcu': {
			// Query cache usage: 100 - free / size * 100 (points: Qcache_free_memory, query_cache_size).
			const free = get(cur, 0);
			const size = get(cur, 1);
			if (free === null || size === null) return null;
			return size === 0 ? 0 : 100 - (free / size) * 100;
		}
		default:
			v = series.display === 'differential' ? diff(0) : get(cur, 0);
	}
	return v === null ? null : v / series.divisor;
}

/** One value per series of the chart. */
export function chartValues(
	chart: ChartDef,
	prev: RawSample | null,
	cur: RawSample,
	seconds: number
): (number | null)[] {
	return chart.series.map((s) => seriesValue(s, prev, cur, seconds));
}

/** Distinct (type, name) points the endpoint has to fetch for these charts. */
export function requiredPoints(charts: ChartDef[]): { type: string; name: string }[] {
	const seen = new Map<string, { type: string; name: string }>();
	for (const c of charts)
		for (const s of c.series)
			for (const p of s.points) seen.set(pointKey(p), { type: p.type, name: p.name });
	return [...seen.values()];
}

/** Rolling history of a chart. */
export interface ChartHistory {
	times: number[];
	values: (number | null)[][];
}

export const MAX_SAMPLES = 40;

export function emptyHistory(chart: ChartDef): ChartHistory {
	return { times: [], values: chart.series.map(() => []) };
}

export function pushSample(
	h: ChartHistory,
	time: number,
	values: (number | null)[],
	max = MAX_SAMPLES
): ChartHistory {
	const times = [...h.times, time].slice(-max);
	const out = values.map((v, i) => [...(h.values[i] ?? []), v].slice(-max));
	return { times, values: out };
}
