<script lang="ts">
	/** Test harness: chart grid + add dialog wired like the monitor page. */
	import { defaultCharts, newChartId } from '#lib/monitor/presets.ts';
	import type { ChartHistory } from '#lib/monitor/math.ts';
	import type { ChartDef } from '#lib/monitor/types.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import AddChartDialog from './add-chart-dialog.svelte';
	import ChartGrid from './chart-grid.svelte';

	let charts = $state<ChartDef[]>(defaultCharts().slice(0, 3));
	let open = $state(false);
	const histories: Record<string, ChartHistory> = {
		questions: { times: [0, 5000, 10000], values: [[1, 2, 3]] }
	};
	let selected = $state('');
</script>

<Button onclick={() => (open = true)}>Add chart</Button>
<ChartGrid
	{charts}
	{histories}
	columns={3}
	onremove={(id) => (charts = charts.filter((c) => c.id !== id))}
	onmove={(id, d) => {
		const i = charts.findIndex((c) => c.id === id);
		const list = [...charts];
		[list[i], list[i + d]] = [list[i + d], list[i]];
		charts = list;
	}}
	onselect={(r) => (selected = `${r.chartId}:${r.start}-${r.end}`)}
/>
<AddChartDialog
	bind:open
	statusNames={['Com_select', 'Com_insert']}
	nextId={() => newChartId(charts)}
	onadd={(c) => (charts = [...charts, c])}
/>
<output data-testid="selected">{selected}</output>
