/** Query statistics (Controllers/Server/Status/QueriesController.php). Pure. */

export interface QueryRow {
	key: string;
	name: string;
	value: number;
	perHour: number;
	percentage: number;
}

export interface ChartSlice {
	name: string;
	value: number;
}

export interface QueryStats {
	total: number;
	perHour: number;
	perMinute: number;
	perSecond: number;
	queries: QueryRow[];
	chart: ChartSlice[];
}

/** Com_* counters with a value > 0, without Com_admin_commands (Data::sortVariables). */
export function usedQueries(status: Record<string, string>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(status)) {
		if (k.includes('Com_') && k !== 'Com_admin_commands' && Number(v) > 0) out[k] = Number(v);
	}
	return out;
}

export function queryStats(used: Record<string, number>, uptime: number): QueryStats {
	const up = uptime > 0 ? uptime : 1;
	const hourFactor = 3600 / up;
	const total = Object.values(used).reduce((a, b) => a + b, 0);
	const sorted = Object.entries(used).sort((a, b) => b[1] - a[1]);
	const chart: ChartSlice[] = [];
	let other = 0;
	const queries: QueryRow[] = [];
	for (const [key, value] of sorted) {
		const name = key.replace(/Com_/g, '').replace(/_/g, ' ');
		// values under 2% are grouped into "Other" once more than 6 slices exist
		if (value < total * 0.02 && chart.length > 6) other += value;
		else chart.push({ name, value });
		queries.push({
			key,
			name,
			value,
			perHour: value * hourFactor,
			percentage: total ? (value * 100) / total : 0
		});
	}
	if (other > 0) chart.push({ name: 'Other', value: other });
	return {
		total,
		perHour: total * hourFactor,
		perMinute: (total * 60) / up,
		perSecond: total / up,
		queries,
		chart
	};
}

/** Pie slices as SVG path arcs (radius 1 around the origin). */
export function pieSlices(chart: ChartSlice[]): { name: string; value: number; d: string }[] {
	const sum = chart.reduce((a, s) => a + s.value, 0);
	if (!sum) return [];
	if (chart.length === 1) {
		return [{ ...chart[0], d: 'M 0 -1 A 1 1 0 1 1 0 1 A 1 1 0 1 1 0 -1 Z' }];
	}
	let angle = -Math.PI / 2;
	return chart.map((s) => {
		const sweep = (s.value / sum) * Math.PI * 2;
		const x1 = Math.cos(angle);
		const y1 = Math.sin(angle);
		angle += sweep;
		const x2 = Math.cos(angle);
		const y2 = Math.sin(angle);
		const large = sweep > Math.PI ? 1 : 0;
		const f = (n: number) => n.toFixed(5);
		return { ...s, d: `M 0 0 L ${f(x1)} ${f(y1)} A 1 1 0 ${large} 1 ${f(x2)} ${f(y2)} Z` };
	});
}
