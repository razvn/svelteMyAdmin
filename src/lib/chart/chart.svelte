<script lang="ts">
	import { paletteIndex, type ChartModel } from './builders.ts';

	interface Props {
		model: ChartModel;
		/** The root `<svg>` (for export). */
		svg?: SVGSVGElement | null;
	}

	let { model, svg = $bindable(null) }: Props = $props();

	const { x0, y0, x1, y1 } = $derived(model.plot);
	let hover = $state<number | null>(null);
	const hovered = $derived(hover === null ? null : model.shapes[hover]);
	const tipAt = $derived.by(() => {
		const s = hovered;
		if (!s || !('tip' in s)) return null;
		const [x, y] =
			s.kind === 'rect'
				? [s.x + s.w / 2, s.y]
				: s.kind === 'point'
					? [s.cx, s.cy]
					: s.kind === 'slice'
						? [s.lx, s.ly]
						: [0, 0];
		return { tip: s.tip, x, y };
	});

	const rotateX = $derived(model.xTicks.length > 8);
	const clip = (label: string, max = 14) =>
		label.length > max ? label.slice(0, max - 1) + '…' : label;
	// Series colours are the `--chart-N` tokens; fill/stroke are inline so exported SVG keeps them.
	const color = (series: number) => `var(--chart-${paletteIndex(series)})`;
</script>

<div class="relative w-full" data-testid="chart">
	<svg
		bind:this={svg}
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 {model.width} {model.height}"
		class="h-auto w-full"
		role="img"
		aria-label={model.title || 'Chart'}
		data-chart-type={model.type}
	>
		{#if model.title}
			<text
				x={model.width / 2}
				y="24"
				text-anchor="middle"
				class="fill-foreground text-[15px] font-semibold"
				data-testid="chart-title">{model.title}</text
			>
		{/if}

		{#if model.type !== 'pie'}
			{#each model.yTicks as t, i (i)}
				{#if model.gridY}
					<line
						x1={x0}
						x2={x1}
						y1={t.pos}
						y2={t.pos}
						class="stroke-border"
						stroke-dasharray="3 3"
					/>
				{/if}
				<text
					x={x0 - 8}
					y={t.pos}
					text-anchor="end"
					dominant-baseline="middle"
					class="fill-muted-foreground text-[11px]">{clip(t.label, 12)}</text
				>
			{/each}
			{#each model.xTicks as t, i (i)}
				{#if model.gridX}
					<line
						x1={t.pos}
						x2={t.pos}
						y1={y0}
						y2={y1}
						class="stroke-border"
						stroke-dasharray="3 3"
					/>
				{/if}
				<text
					x={t.pos}
					y={y1 + 16}
					text-anchor={rotateX ? 'end' : 'middle'}
					transform={rotateX ? `rotate(-35 ${t.pos} ${y1 + 16})` : undefined}
					class="fill-muted-foreground text-[11px]">{clip(t.label)}</text
				>
			{/each}
			<line x1={x0} x2={x1} {y1} y2={y1} class="stroke-muted-foreground" />
			<line x1={x0} x2={x0} y1={y0} y2={y1} class="stroke-muted-foreground" />
			{#if model.bottomLabel}
				<text
					x={(x0 + x1) / 2}
					y={model.height - 8}
					text-anchor="middle"
					class="fill-foreground text-xs font-medium">{model.bottomLabel}</text
				>
			{/if}
			{#if model.leftLabel}
				<text
					transform="rotate(-90 14 {(y0 + y1) / 2})"
					x="14"
					y={(y0 + y1) / 2}
					text-anchor="middle"
					class="fill-foreground text-xs font-medium">{model.leftLabel}</text
				>
			{/if}
		{/if}

		{#each model.shapes as s, i (i)}
			{#if s.kind === 'rect'}
				<rect
					x={s.x}
					y={s.y}
					width={s.w}
					height={s.h}
					rx="2"
					style="fill: {color(s.series)}"
					opacity={hover === i ? 1 : 0.85}
					data-shape="rect"
					role="img"
					aria-label={s.tip}
					onpointerenter={() => (hover = i)}
					onpointerleave={() => (hover = null)}
				/>
			{:else if s.kind === 'area'}
				<path d={s.d} style="fill: {color(s.series)}" opacity="0.25" data-shape="area" />
			{:else if s.kind === 'line'}
				<path
					d={s.d}
					style="fill: none; stroke: {color(s.series)}"
					stroke-width="2"
					stroke-linejoin="round"
					data-shape="line"
				/>
			{:else if s.kind === 'point'}
				<circle
					cx={s.cx}
					cy={s.cy}
					r={hover === i ? 6 : 4}
					style="fill: {color(s.series)}; stroke: var(--card)"
					stroke-width="1.5"
					data-shape="point"
					role="img"
					aria-label={s.tip}
					onpointerenter={() => (hover = i)}
					onpointerleave={() => (hover = null)}
				/>
			{:else}
				<path
					d={s.d}
					style="fill: {color(s.series)}; stroke: var(--card)"
					stroke-width="2"
					opacity={hover === i ? 1 : 0.9}
					data-shape="slice"
					role="img"
					aria-label={s.tip}
					onpointerenter={() => (hover = i)}
					onpointerleave={() => (hover = null)}
				/>
			{/if}
		{/each}
	</svg>

	{#if tipAt}
		<div
			role="tooltip"
			class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-card"
			style="left: {(tipAt.x / model.width) * 100}%; top: calc({(tipAt.y / model.height) *
				100}% - 8px)"
		>
			{tipAt.tip}
		</div>
	{/if}

	{#if model.legend.length > 1 || model.type === 'pie'}
		<ul
			class="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs"
			data-testid="chart-legend"
		>
			{#each model.legend as l (l.series)}
				<li class="flex items-center gap-1.5">
					<span class="size-2.5 rounded-sm" style="background: {color(l.series)}"></span>
					{l.name}
				</li>
			{/each}
		</ul>
	{/if}
</div>
