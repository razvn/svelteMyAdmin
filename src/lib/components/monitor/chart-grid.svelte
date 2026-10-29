<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import X from '@lucide/svelte/icons/x';
	import Chart from '#lib/chart/chart.svelte';
	import { buildChart } from '#lib/chart/builders.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { ChartHistory } from '#lib/monitor/math.ts';
	import type { ChartDef } from '#lib/monitor/types.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';

	interface Props {
		charts: ChartDef[];
		histories: Record<string, ChartHistory>;
		columns: 2 | 3 | 4;
		onremove: (id: string) => void;
		onmove: (id: string, delta: -1 | 1) => void;
		/** A time range (ms since epoch) was selected on a chart. */
		onselect?: (range: { chartId: string; start: number; end: number }) => void;
		/** Highlighted range, in ms. */
		selection?: { start: number; end: number } | null;
	}

	let {
		charts,
		histories,
		columns,
		onremove,
		onmove,
		onselect,
		selection = null
	}: Props = $props();

	const { t } = useI18n();
	const COLS = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' } as const;
	const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

	function model(chart: ChartDef, h: ChartHistory | undefined) {
		const times = h?.times ?? [];
		// Label every 5th sample only; the axis would be unreadable otherwise.
		const labels = times.map((ms, i) => (i % 5 === times.length % 5 ? clock(ms) : ''));
		return buildChart({
			type: 'line',
			xValues: labels,
			series: chart.series.map((s, i) => ({
				name: t(s.label),
				values: (h?.values[i] ?? []).map((v) => (v === null ? null : String(v)))
			})),
			yLabel: chart.unit,
			width: 520,
			height: 260
		});
	}

	const hasData = (h: ChartHistory | undefined) =>
		!!h && h.values.some((vs) => vs.some((v) => v !== null));

	// Drag selection on a chart: fractions of the width -> sample times.
	let drag = $state<{ id: string; a: number; b: number } | null>(null);

	function fraction(e: PointerEvent): number {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
	}

	function finishDrag(chart: ChartDef) {
		const d = drag;
		drag = null;
		const h = histories[chart.id];
		if (!d || !h || h.times.length < 2 || Math.abs(d.a - d.b) < 0.02) return;
		const t0 = h.times[0];
		const span = h.times[h.times.length - 1] - t0;
		const [lo, hi] = d.a < d.b ? [d.a, d.b] : [d.b, d.a];
		onselect?.({ chartId: chart.id, start: t0 + lo * span, end: t0 + hi * span });
	}

	function wholeRange(chart: ChartDef) {
		const h = histories[chart.id];
		if (!h || h.times.length < 2) return;
		onselect?.({ chartId: chart.id, start: h.times[0], end: h.times[h.times.length - 1] });
	}

	function band(chart: ChartDef): { left: number; width: number } | null {
		if (drag?.id === chart.id) {
			const [lo, hi] = drag.a < drag.b ? [drag.a, drag.b] : [drag.b, drag.a];
			return { left: lo * 100, width: (hi - lo) * 100 };
		}
		const h = histories[chart.id];
		if (!selection || !h || h.times.length < 2) return null;
		const t0 = h.times[0];
		const span = h.times[h.times.length - 1] - t0;
		const lo = Math.max(0, (selection.start - t0) / span);
		const hi = Math.min(1, (selection.end - t0) / span);
		return hi > lo ? { left: lo * 100, width: (hi - lo) * 100 } : null;
	}
</script>

<div class="grid grid-cols-1 gap-4 md:grid-cols-2 {COLS[columns]}" data-testid="chart-grid">
	{#each charts as chart, i (chart.id)}
		{@const h = histories[chart.id]}
		{@const sel = band(chart)}
		<Card.Root
			class="gap-2 py-4"
			data-testid="monitor-chart"
			data-chart-id={chart.id}
			data-samples={h?.times.length ?? 0}
		>
			<div class="flex items-center justify-between gap-2 px-4">
				<h3 class="truncate text-sm font-semibold" data-testid="monitor-chart-title">
					{t(chart.title)}{chart.unit ? ` (${chart.unit})` : ''}
				</h3>
				<div class="flex shrink-0 items-center">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t('Select whole range of {title}', { title: t(chart.title) })}
						title={t('Select the whole visible range for log analysis')}
						data-testid="select-range"
						onclick={() => wholeRange(chart)}
					>
						<span class="text-xs">[ ]</span>
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t('Move {title} earlier', { title: t(chart.title) })}
						disabled={i === 0}
						onclick={() => onmove(chart.id, -1)}
					>
						<ArrowLeft class="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t('Move {title} later', { title: t(chart.title) })}
						disabled={i === charts.length - 1}
						onclick={() => onmove(chart.id, 1)}
					>
						<ArrowRight class="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t('Remove chart {title}', { title: t(chart.title) })}
						data-testid="remove-chart"
						onclick={() => onremove(chart.id)}
					>
						<X class="size-4" />
					</Button>
				</div>
			</div>
			<div class="relative px-2">
				{#if hasData(h)}
					<Chart model={model(chart, h)} />
				{:else}
					<p class="flex h-40 items-center justify-center text-sm text-muted-foreground">
						{t('Waiting for data…')}
					</p>
				{/if}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="absolute inset-x-2 top-0 bottom-0 cursor-crosshair touch-none"
					data-testid="chart-surface"
					onpointerdown={(e) => {
						(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
						const f = fraction(e);
						drag = { id: chart.id, a: f, b: f };
					}}
					onpointermove={(e) => {
						if (drag?.id === chart.id) drag = { ...drag, b: fraction(e) };
					}}
					onpointerup={() => finishDrag(chart)}
					onpointercancel={() => (drag = null)}
				>
					{#if sel}
						<div
							class="pointer-events-none absolute top-0 bottom-0 bg-primary/15 ring-1 ring-primary/40"
							style="left: {sel.left}%; width: {sel.width}%"
						></div>
					{/if}
				</div>
			</div>
		</Card.Root>
	{/each}
	{#if charts.length === 0}
		<p class="col-span-full py-10 text-center text-sm text-muted-foreground">
			{t('No charts. Use "Add chart" to create one.')}
		</p>
	{/if}
</div>
