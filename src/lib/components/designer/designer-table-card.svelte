<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Link2 from '@lucide/svelte/icons/link-2';
	import ListTree from '@lucide/svelte/icons/list-tree';
	import { HEADER_H, ROW_H, visibleColumns } from '#lib/designer/geometry.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { DesignerTable } from '#lib/designer/types.ts';
	import { cn } from '#lib/utils.ts';

	interface Props {
		table: DesignerTable;
		x: number;
		y: number;
		width: number;
		collapsed?: boolean;
		keysOnly?: boolean;
		/** Canvas zoom: pointer deltas are divided by it. */
		scale?: number;
		selected?: boolean;
		/** Called while the header is dragged with the new (unsnapped) position. */
		onmove?: (x: number, y: number) => void;
		/** Called once when the drag ends. */
		onmoveend?: () => void;
		ontoggle?: () => void;
		oncolumndown?: (event: PointerEvent, column: string) => void;
		oncolumnclick?: (column: string) => void;
		onselect?: () => void;
	}

	const { t } = useI18n();
	let {
		table,
		x,
		y,
		width,
		collapsed = false,
		keysOnly = false,
		scale = 1,
		selected = false,
		onmove,
		onmoveend,
		ontoggle,
		oncolumndown,
		oncolumnclick,
		onselect
	}: Props = $props();

	const columns = $derived(visibleColumns(table, { collapsed, keysOnly }));

	let drag: { px: number; py: number; x: number; y: number; moved: boolean } | null = null;

	function down(e: PointerEvent) {
		if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { px: e.clientX, py: e.clientY, x, y, moved: false };
		onselect?.();
		e.stopPropagation();
	}

	function move(e: PointerEvent) {
		if (!drag) return;
		const dx = (e.clientX - drag.px) / scale;
		const dy = (e.clientY - drag.py) / scale;
		if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 1) return;
		drag.moved = true;
		onmove?.(Math.max(0, drag.x + dx), Math.max(0, drag.y + dy));
	}

	function up(e: PointerEvent) {
		if (!drag) return;
		const moved = drag.moved;
		drag = null;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		if (moved) onmoveend?.();
	}
</script>

<div
	class={cn(
		'absolute rounded-lg border bg-card text-card-foreground shadow-card select-none',
		selected && 'ring-2 ring-ring'
	)}
	style:left="{x}px"
	style:top="{y}px"
	style:width="{width}px"
	data-testid="designer-table-{table.name}"
	data-table={table.name}
>
	<div
		class="flex cursor-move touch-none items-center gap-1 rounded-t-lg border-b bg-primary-soft px-2 text-sm font-semibold text-primary"
		class:rounded-b-lg={collapsed}
		class:border-b-0={collapsed}
		style:height="{HEADER_H}px"
		role="presentation"
		data-testid="designer-header-{table.name}"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
	>
		<button
			type="button"
			class="flex size-5 shrink-0 items-center justify-center rounded hover:bg-primary/10"
			aria-label={collapsed
				? t('Expand {name}', { name: table.name })
				: t('Collapse {name}', { name: table.name })}
			aria-expanded={!collapsed}
			onclick={() => ontoggle?.()}
		>
			{#if collapsed}<ChevronRight class="size-4" />{:else}<ChevronDown class="size-4" />{/if}
		</button>
		<span class="truncate font-mono">{table.name}</span>
	</div>
	{#if !collapsed}
		<ul class="pb-1" aria-label={t('Columns of {name}', { name: table.name })}>
			{#each columns as column (column.name)}
				<li
					class="flex items-center gap-1 px-2 text-xs hover:bg-muted"
					style:height="{ROW_H}px"
					data-col={column.name}
					data-table={table.name}
					onpointerdown={(e) => oncolumndown?.(e, column.name)}
					onclick={() => oncolumnclick?.(column.name)}
					role="presentation"
				>
					<span class="flex w-3.5 shrink-0 justify-center">
						{#if column.primary}
							<KeyRound class="size-3.5 text-warning" aria-label={t('Primary key')} />
						{:else if column.foreign}
							<Link2 class="size-3.5 text-primary" aria-label={t('Foreign key')} />
						{:else if column.unique || column.indexed}
							<ListTree
								class="size-3.5 text-muted-foreground"
								aria-label={column.unique ? t('Unique key') : t('Indexed')}
							/>
						{/if}
					</span>
					<span
						class={cn('truncate font-mono', column.primary && 'underline')}
						class:font-semibold={table.displayField === column.name}
					>
						{column.name}
					</span>
					<span class="ms-auto truncate ps-2 text-[10px] text-muted-foreground">{column.type}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
