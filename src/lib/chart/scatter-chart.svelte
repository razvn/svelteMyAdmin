<script lang="ts">
	import { scale, type Axis, type ScatterPoint } from './scatter.ts';

	interface Props {
		points: ScatterPoint[];
		xAxis: Axis;
		yAxis: Axis;
		xTitle: string;
		yTitle: string;
		selected?: number | null;
		onselect?: (id: number) => void;
	}

	let { points, xAxis, yAxis, xTitle, yTitle, selected = null, onselect }: Props = $props();

	const W = 800;
	const H = 480;
	const M = { l: 72, r: 24, t: 16, b: 56 };

	const sx = $derived(scale(xAxis.domain, M.l, W - M.r));
	const sy = $derived(scale(yAxis.domain, H - M.b, M.t));
	let hover = $state<number | null>(null);
	const hovered = $derived(points.find((p) => p.id === hover) ?? null);

	// Category labels are rotated when there are many of them.
	const rotateX = $derived(xAxis.kind === 'category' && xAxis.ticks.length > 8);

	function clip(label: string, max = 14): string {
		return label.length > max ? label.slice(0, max - 1) + '…' : label;
	}
</script>

<div class="relative w-full" data-testid="scatter-chart">
	<svg viewBox="0 0 {W} {H}" class="h-auto w-full" role="img" aria-label="{yTitle} by {xTitle}">
		{#each yAxis.ticks as tick (tick.value)}
			<line
				x1={M.l}
				x2={W - M.r}
				y1={sy(tick.value)}
				y2={sy(tick.value)}
				class="stroke-border"
				stroke-dasharray="3 3"
			/>
			<text
				x={M.l - 8}
				y={sy(tick.value)}
				text-anchor="end"
				dominant-baseline="middle"
				class="fill-muted-foreground text-[11px]"
				data-axis="y-tick">{clip(tick.label, 12)}</text
			>
		{/each}
		{#each xAxis.ticks as tick (tick.value)}
			<line
				x1={sx(tick.value)}
				x2={sx(tick.value)}
				y1={M.t}
				y2={H - M.b}
				class="stroke-border"
				stroke-dasharray="3 3"
			/>
			<text
				x={sx(tick.value)}
				y={H - M.b + 16}
				text-anchor={rotateX ? 'end' : 'middle'}
				transform={rotateX ? `rotate(-35 ${sx(tick.value)} ${H - M.b + 16})` : undefined}
				class="fill-muted-foreground text-[11px]"
				data-axis="x-tick">{clip(tick.label)}</text
			>
		{/each}
		<line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} class="stroke-muted-foreground" />
		<line x1={M.l} x2={M.l} y1={M.t} y2={H - M.b} class="stroke-muted-foreground" />
		<text
			x={(M.l + W - M.r) / 2}
			y={H - 8}
			text-anchor="middle"
			class="fill-foreground text-xs font-medium">{xTitle}</text
		>
		<text
			transform="rotate(-90 14 {(M.t + H - M.b) / 2})"
			x="14"
			y={(M.t + H - M.b) / 2}
			text-anchor="middle"
			class="fill-foreground text-xs font-medium">{yTitle}</text
		>

		{#each points as p (p.id)}
			<circle
				cx={sx(p.x)}
				cy={sy(p.y)}
				r={selected === p.id || hover === p.id ? 7 : 5}
				class="cursor-pointer fill-chart-1/70 stroke-chart-1 outline-none focus-visible:stroke-foreground focus-visible:stroke-2"
				stroke-width="1.5"
				role="button"
				tabindex="0"
				aria-label="Row {p.id + 1}: {p.tip.map((t) => `${t.name} ${t.value}`).join(', ')}"
				data-point={p.id}
				onpointerenter={() => (hover = p.id)}
				onpointerleave={() => (hover = null)}
				onfocus={() => (hover = p.id)}
				onblur={() => (hover = null)}
				onclick={() => onselect?.(p.id)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onselect?.(p.id);
					}
				}}
			/>
		{/each}
	</svg>

	{#if hovered}
		<div
			role="tooltip"
			class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-card"
			style="left: {(sx(hovered.x) / W) * 100}%; top: calc({(sy(hovered.y) / H) * 100}% - 10px)"
		>
			{#each hovered.tip as line (line.name)}
				<div class="whitespace-nowrap">
					<span class="text-muted-foreground">{line.name}:</span>
					{line.value}
				</div>
			{/each}
		</div>
	{/if}
</div>
