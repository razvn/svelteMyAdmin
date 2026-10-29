<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { paletteIndex } from '#lib/chart/builders.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import {
		boundsOf,
		fitViewport,
		labelAnchor,
		mergeBounds,
		emptyBounds,
		primitivePath,
		projectionFor,
		tilesFor,
		tileUrl
	} from './projection.ts';
	import { primitives, type Geometry } from './wkt.ts';

	export interface MapRow {
		label: string;
		geometry: Geometry;
		values: Record<string, string | null>;
	}

	interface Props {
		rows: MapRow[];
		srid: number;
		/** Show OpenStreetMap tiles (SRID 4326 only). */
		tiles?: boolean;
		/** The root `<svg>` (for export). */
		svg?: SVGSVGElement | null;
	}

	const { t } = useI18n();
	let { rows, srid, tiles = false, svg = $bindable(null) }: Props = $props();

	const W = 800;
	const H = 520;

	const showTiles = $derived(tiles && srid === 4326);
	const view = $derived.by(() => {
		let bounds = emptyBounds();
		for (const r of rows) bounds = mergeBounds(bounds, boundsOf(r.geometry));
		return fitViewport(bounds, projectionFor(srid, showTiles), { width: W, height: H });
	});
	const tileList = $derived(showTiles ? tilesFor(view) : []);
	const shapes = $derived(
		rows.map((r, i) => ({
			row: r,
			color: `var(--chart-${paletteIndex(i)})`,
			prims: primitives(r.geometry).map((p) => ({
				p,
				d: p.kind === 'point' ? '' : primitivePath(p, view.project),
				at: p.kind === 'point' ? view.project(p.at) : null
			})),
			anchor: (() => {
				const a = labelAnchor(r.geometry);
				return a ? view.project(a) : null;
			})()
		}))
	);

	// zoom / pan
	let k = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let drag: { x: number; y: number; tx: number; ty: number } | null = null;
	let hover = $state<{ i: number; x: number; y: number } | null>(null);

	function reset() {
		k = 1;
		tx = 0;
		ty = 0;
	}
	/** Zoom by `factor` keeping the SVG point (cx, cy) fixed. */
	function zoomAt(factor: number, cx = W / 2, cy = H / 2) {
		const next = Math.min(Math.max(k * factor, 0.5), 200);
		const f = next / k;
		tx = cx - (cx - tx) * f;
		ty = cy - (cy - ty) * f;
		k = next;
	}
	function toSvg(e: { clientX: number; clientY: number }): [number, number] {
		const r = svg!.getBoundingClientRect();
		return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
	}
	function onwheel(e: WheelEvent) {
		e.preventDefault();
		const [x, y] = toSvg(e);
		zoomAt(e.deltaY < 0 ? 1.25 : 0.8, x, y);
	}
	function onpointerdown(e: PointerEvent) {
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		const [x, y] = toSvg(e);
		drag = { x, y, tx, ty };
	}
	function onpointermove(e: PointerEvent) {
		if (!drag) return;
		const [x, y] = toSvg(e);
		tx = drag.tx + x - drag.x;
		ty = drag.ty + y - drag.y;
	}
	const onpointerup = () => (drag = null);

	const hovered = $derived(hover ? shapes[hover.i] : null);
</script>

<div class="relative w-full" data-testid="gis-map">
	<svg
		bind:this={svg}
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 {W} {H}"
		class="w-full touch-none rounded-lg border bg-card"
		role="img"
		aria-label={t('Geometry visualization')}
		{onwheel}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
	>
		<g transform="translate({tx} {ty}) scale({k})">
			{#if tileList.length}
				<g data-no-export="true" data-testid="gis-tiles">
					{#each tileList as t (`${t.z}/${t.x}/${t.y}`)}
						<image
							href={tileUrl(t)}
							x={t.px}
							y={t.py}
							width={t.size}
							height={t.size}
							preserveAspectRatio="none"
						/>
					{/each}
				</g>
			{/if}
			{#each shapes as s, i (i)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<g
					data-testid="gis-shape"
					fill={s.color}
					stroke={s.color}
					onpointerenter={(e) => {
						const [x, y] = toSvg(e);
						hover = { i, x, y };
					}}
					onpointermove={(e) => {
						if (hover?.i === i) {
							const [x, y] = toSvg(e);
							hover = { i, x, y };
						}
					}}
					onpointerleave={() => (hover = null)}
				>
					{#each s.prims as prim, j (j)}
						{#if prim.at}
							<circle cx={prim.at[0]} cy={prim.at[1]} r={5 / k} fill-opacity="0.8" />
						{:else if prim.p.kind === 'line'}
							<path
								d={prim.d}
								fill="none"
								stroke-width="2"
								vector-effect="non-scaling-stroke"
								stroke-linejoin="round"
							/>
						{:else}
							<path
								d={prim.d}
								fill-rule="evenodd"
								fill-opacity="0.35"
								stroke-width="1.5"
								vector-effect="non-scaling-stroke"
							/>
						{/if}
					{/each}
					{#if s.row.label && s.anchor}
						<text
							x={s.anchor[0] + 8 / k}
							y={s.anchor[1] - 8 / k}
							font-size={12 / k}
							stroke="none"
							class="fill-foreground"
							data-testid="gis-label">{s.row.label}</text
						>
					{/if}
				</g>
			{/each}
		</g>
	</svg>

	<div class="absolute top-2 right-2 flex flex-col gap-1">
		<Button
			type="button"
			size="icon-sm"
			variant="outline"
			aria-label={t('Zoom in')}
			onclick={() => zoomAt(1.5)}
		>
			<Plus />
		</Button>
		<Button
			type="button"
			size="icon-sm"
			variant="outline"
			aria-label={t('Zoom out')}
			onclick={() => zoomAt(1 / 1.5)}
		>
			<Minus />
		</Button>
		<Button type="button" size="icon-sm" variant="outline" aria-label={t('Reset zoom')} onclick={reset}>
			<RotateCcw />
		</Button>
	</div>

	{#if hover && hovered}
		<div
			class="pointer-events-none absolute z-10 max-w-xs rounded-lg border bg-popover p-2 text-xs text-popover-foreground shadow-md"
			style="left: {(hover.x / W) * 100}%; top: {(hover.y / H) *
				100}%; transform: translate(10px, 10px)"
			data-testid="gis-tooltip"
		>
			{#each Object.entries(hovered.row.values) as [name, value] (name)}
				<div class="flex gap-2">
					<span class="font-medium">{name}:</span>
					<span class="truncate text-muted-foreground">{value ?? 'NULL'}</span>
				</div>
			{/each}
		</div>
	{/if}

	{#if showTiles}
		<p class="mt-1 text-xs text-muted-foreground">
			Map tiles ©
			<a
				class="underline"
				href="https://www.openstreetmap.org/copyright"
				target="_blank"
				rel="noreferrer">{t('OpenStreetMap contributors')}</a
			>
		</p>
	{/if}
</div>
