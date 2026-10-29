<script lang="ts">
	import Maximize from '@lucide/svelte/icons/maximize';
	import ZoomIn from '@lucide/svelte/icons/zoom-in';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';
	import { Button } from '#lib/components/ui/button/index.ts';
	import {
		GRID,
		bounds,
		cardRect,
		columnAnchorY,
		snap,
		tableWidth
	} from '#lib/designer/geometry.ts';
	import { routeRelation } from '#lib/designer/routing.ts';
	import type { DesignerView } from '#lib/designer/settings.ts';
	import type { DesignerRelation, DesignerTable, Positions } from '#lib/designer/types.ts';
	import DesignerTableCard from './designer-table-card.svelte';

	export interface ColumnRef {
		table: string;
		column: string;
	}

	interface Props {
		tables: DesignerTable[];
		relations: DesignerRelation[];
		positions: Positions;
		view: DesignerView;
		keysOnly?: boolean;
		/** Collapsed cards by table name (the "all small" option collapses every card). */
		collapsed?: Record<string, boolean>;
		selectedRelation?: string | null;
		/** Called after a drag ended (positions are already updated). */
		onmoveend?: () => void;
		/** A column was dragged onto another column. */
		onconnect?: (from: ColumnRef, to: ColumnRef) => void;
		onrelationclick?: (relation: DesignerRelation) => void;
		oncolumnclick?: (ref: ColumnRef) => void;
		ontoggle?: (table: string) => void;
	}

	let {
		tables,
		relations,
		positions = $bindable(),
		view,
		keysOnly = false,
		collapsed = {},
		selectedRelation = null,
		onmoveend,
		onconnect,
		onrelationclick,
		oncolumnclick,
		ontoggle
	}: Props = $props();

	let zoom = $state(1);
	let pan = $state({ x: 20, y: 20 });
	let host: HTMLDivElement | undefined = $state();
	let selectedTable = $state<string | null>(null);
	let pending = $state<{ from: ColumnRef; x: number; y: number; sx: number; sy: number } | null>(
		null
	);

	const viewOf = (name: string) => ({ collapsed: view.small || !!collapsed[name], keysOnly });

	const cards = $derived(
		tables
			.filter((t) => positions[t.name])
			.map((t) => {
				const v = viewOf(t.name);
				const rect = cardRect(t, positions[t.name], v);
				return { table: t, rect, view: v };
			})
	);
	const byName = $derived(new Map(cards.map((c) => [c.table.name, c])));

	const lines = $derived(
		relations.flatMap((r) => {
			const a = byName.get(r.fromTable);
			const b = byName.get(r.toTable);
			if (!a || !b) return [];
			const route = routeRelation(
				a.rect,
				columnAnchorY(a.table, r.fromColumn, a.rect, a.view),
				b.rect,
				columnAnchorY(b.table, r.toColumn, b.rect, b.view),
				view.angular ? 'angular' : 'direct'
			);
			return [{ relation: r, route }];
		})
	);

	function setPosition(name: string, x: number, y: number) {
		positions[name] = { x: snap(x, view.snapToGrid), y: snap(y, view.snapToGrid) };
	}

	function worldPoint(e: { clientX: number; clientY: number }) {
		const box = host?.getBoundingClientRect();
		return {
			x: (e.clientX - (box?.left ?? 0) - pan.x) / zoom,
			y: (e.clientY - (box?.top ?? 0) - pan.y) / zoom
		};
	}

	function clampZoom(z: number) {
		return Math.min(2, Math.max(0.25, Math.round(z * 100) / 100));
	}

	function zoomBy(factor: number) {
		zoom = clampZoom(zoom * factor);
	}

	function fit() {
		const rects = cards.map((c) => c.rect);
		if (!host || rects.length === 0) return;
		const b = bounds(rects);
		const w = host.clientWidth - 40;
		const h = host.clientHeight - 40;
		zoom = clampZoom(Math.min(1, w / b.w, h / b.h));
		pan = { x: 20 - b.x * zoom, y: 20 - b.y * zoom };
	}

	// pan: drag on the background
	let panning: { px: number; py: number; x: number; y: number } | null = null;
	function panDown(e: PointerEvent) {
		if (e.button !== 0 || e.target !== e.currentTarget) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		panning = { px: e.clientX, py: e.clientY, x: pan.x, y: pan.y };
		selectedTable = null;
	}
	function panMove(e: PointerEvent) {
		if (!panning) return;
		pan = { x: panning.x + e.clientX - panning.px, y: panning.y + e.clientY - panning.py };
	}
	function panUp() {
		panning = null;
	}

	function wheel(e: WheelEvent) {
		if (!(e.ctrlKey || e.metaKey)) {
			pan = { x: pan.x - e.deltaX, y: pan.y - e.deltaY };
		} else {
			zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
		}
		e.preventDefault();
	}

	// connect: drag from a column to a column of another table
	function columnDown(e: PointerEvent, table: string, column: string) {
		if (e.button !== 0) return;
		e.stopPropagation();
		const start = worldPoint(e);
		const from = { table, column };
		let dragging = false;
		const onMove = (ev: PointerEvent) => {
			const p = worldPoint(ev);
			if (!dragging && Math.hypot(p.x - start.x, p.y - start.y) * zoom < 5) return;
			dragging = true;
			pending = { from, x: p.x, y: p.y, sx: start.x, sy: start.y };
		};
		const onUp = (ev: PointerEvent) => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			pending = null;
			if (!dragging) return;
			const el = document
				.elementFromPoint(ev.clientX, ev.clientY)
				?.closest<HTMLElement>('[data-col]');
			if (!el || !host?.contains(el)) return;
			const to = { table: el.dataset.table ?? '', column: el.dataset.col ?? '' };
			if (to.table && (to.table !== from.table || to.column !== from.column)) onconnect?.(from, to);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}

	const pendingPath = $derived.by(() => {
		if (!pending) return '';
		const a = byName.get(pending.from.table);
		if (!a) return '';
		const y = columnAnchorY(a.table, pending.from.column, a.rect, a.view);
		const x = pending.x >= a.rect.x + a.rect.w / 2 ? a.rect.x + a.rect.w : a.rect.x;
		return `M${x} ${y} L${pending.x} ${pending.y}`;
	});
</script>

<div
	bind:this={host}
	class="relative h-full min-h-0 w-full touch-none overflow-hidden rounded-xl border bg-background"
	style:background-image="radial-gradient(var(--border) 1px, transparent 1px)"
	style:background-size="{GRID * 2 * zoom}px {GRID * 2 * zoom}px"
	style:background-position="{pan.x}px {pan.y}px"
	data-testid="designer-canvas"
	role="application"
	aria-label="Designer canvas"
	onpointerdown={panDown}
	onpointermove={panMove}
	onpointerup={panUp}
	onwheel={wheel}
>
	<div
		class="absolute top-0 left-0 origin-top-left"
		style:transform="translate({pan.x}px, {pan.y}px) scale({zoom})"
		data-testid="designer-world"
		data-zoom={zoom}
	>
		<svg class="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
			{#if view.relationLines}
				{#each lines as { relation, route } (relation.id)}
					{@const active = selectedRelation === relation.id}
					<g
						class={active ? 'text-destructive' : 'text-primary'}
						data-testid="designer-relation"
						data-relation={relation.id}
						data-from="{relation.fromTable}.{relation.fromColumn}"
						data-to="{relation.toTable}.{relation.toColumn}"
						data-kind={relation.kind}
					>
						<path
							d={route.path}
							fill="none"
							stroke="currentColor"
							stroke-width={active ? 2.5 : 1.5}
							stroke-dasharray={relation.kind === 'internal' ? '6 4' : undefined}
						/>
						<polygon points={route.arrow} fill="currentColor" />
						<path
							d={route.path}
							fill="none"
							stroke="transparent"
							stroke-width="12"
							class="pointer-events-stroke cursor-pointer"
							style:pointer-events="stroke"
							role="button"
							tabindex="-1"
							aria-label="Relation {relation.fromTable}.{relation.fromColumn} to {relation.toTable}.{relation.toColumn}"
							onpointerdown={(e) => e.stopPropagation()}
							onclick={() => onrelationclick?.(relation)}
							onkeydown={(e) => e.key === 'Enter' && onrelationclick?.(relation)}
						/>
					</g>
				{/each}
			{/if}
			{#if pending}
				<path
					d={pendingPath}
					fill="none"
					stroke="currentColor"
					class="text-primary"
					stroke-dasharray="4 3"
					stroke-width="2"
				/>
			{/if}
		</svg>
		{#each cards as card (card.table.name)}
			<DesignerTableCard
				table={card.table}
				x={card.rect.x}
				y={card.rect.y}
				width={tableWidth(card.table)}
				collapsed={card.view.collapsed}
				{keysOnly}
				scale={zoom}
				selected={selectedTable === card.table.name}
				onselect={() => (selectedTable = card.table.name)}
				onmove={(x, y) => setPosition(card.table.name, x, y)}
				onmoveend={() => onmoveend?.()}
				ontoggle={() => ontoggle?.(card.table.name)}
				oncolumndown={(e, column) => columnDown(e, card.table.name, column)}
				oncolumnclick={(column) => oncolumnclick?.({ table: card.table.name, column })}
			/>
		{/each}
	</div>
	<div
		class="absolute end-3 bottom-3 flex items-center gap-1 rounded-lg border bg-card p-1 shadow-card"
	>
		<Button variant="ghost" size="icon-sm" aria-label="Zoom out" onclick={() => zoomBy(1 / 1.2)}>
			<ZoomOut />
		</Button>
		<span
			class="w-10 text-center text-xs text-muted-foreground tabular-nums"
			data-testid="designer-zoom"
		>
			{Math.round(zoom * 100)}%
		</span>
		<Button variant="ghost" size="icon-sm" aria-label="Zoom in" onclick={() => zoomBy(1.2)}>
			<ZoomIn />
		</Button>
		<Button variant="ghost" size="icon-sm" aria-label="Fit to screen" onclick={fit}>
			<Maximize />
		</Button>
	</div>
</div>
