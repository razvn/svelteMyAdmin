<script lang="ts">
	/**
	 * Reusable result grid (phpMyAdmin's Display/Results). Independent of any route: give it column
	 * metadata and rows of cells; sorting, selection, row actions and editing are callbacks/snippets.
	 */
	import type { Snippet } from 'svelte';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import Wand from '@lucide/svelte/icons/wand-sparkles';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { cn } from '#lib/utils.ts';
	import { isNumericKind } from '#lib/table/column-kind.ts';
	import { nextSort, type OrderConfig, type Sort } from '#lib/table/sort.ts';
	import CellEditor from './cell-editor.svelte';
	import CellValue from './cell-value.svelte';
	import TransformedValue from './transformed-value.svelte';
	import type { Transformed } from '#lib/transformations/types.ts';
	import type { Cell } from './format.ts';
	import type { CellLink, EditResult, GridColumn } from './types.ts';

	interface Props {
		columns: GridColumn[];
		rows: Cell[][];
		/** Truncate text cells to this many characters (config `LimitChars`; 0 = off). */
		limitChars?: number;
		sort?: Sort | null;
		/** Config `Order` (first direction of a header click). */
		order?: OrderConfig;
		onsort?: (sort: Sort | null) => void;
		/** Names of the hidden columns. */
		hidden?: string[];
		onhiddenchange?: (hidden: string[]) => void;
		/** Show a checkbox column; `selected` holds row indexes. */
		selectable?: boolean;
		selected?: number[];
		/** Per-row actions cell; rendered on the side(s) given by `actionsPosition`. */
		actions?: Snippet<[{ row: number }]>;
		actionsPosition?: 'none' | 'left' | 'right' | 'both';
		/** Repeat the header row every N rows (config `RepeatCells`; 0 = off). */
		repeatCells?: number;
		/** Column name => link per row index. */
		links?: Record<string, (CellLink | null)[]>;
		/** Browser display transformations: column index => one entry per row (null = raw). */
		transforms?: Record<number, (Transformed | null)[]>;
		/** Download URL of a binary cell. */
		downloadHref?: (row: number, column: GridColumn) => string | null;
		/** Provide to enable double-click editing; resolves with the stored value or an error. */
		onedit?: (row: number, column: GridColumn, value: string | null) => Promise<EditResult>;
		empty?: Snippet;
		class?: string;
	}

	let {
		columns,
		rows,
		limitChars = 50,
		sort = null,
		order = 'SMART',
		onsort,
		hidden = $bindable([]),
		onhiddenchange,
		selectable = false,
		selected = $bindable([]),
		actions,
		actionsPosition = 'left',
		repeatCells = 0,
		links = {},
		transforms = {},
		downloadHref,
		onedit,
		empty,
		class: className
	}: Props = $props();

	const visible = $derived(
		columns
			.map((column, index) => ({ column, index }))
			.filter((c) => !hidden.includes(c.column.name))
	);
	const showLeft = $derived(
		!!actions && (actionsPosition === 'left' || actionsPosition === 'both')
	);
	const showRight = $derived(
		!!actions && (actionsPosition === 'right' || actionsPosition === 'both')
	);
	const allSelected = $derived(rows.length > 0 && selected.length === rows.length);

	// Cells updated by inline editing, dropped whenever fresh rows arrive.
	let patched = $state<Record<string, Cell>>({});
	let expanded = $state<Record<string, boolean>>({});
	$effect(() => {
		void rows;
		patched = {};
		expanded = {};
	});

	let showRaw = $state(false);
	const hasTransforms = $derived(Object.keys(transforms).length > 0);

	function transformedAt(r: number, c: number): Transformed | null {
		if (showRaw || `${r}:${c}` in patched) return null;
		return transforms[c]?.[r] ?? null;
	}

	let editing = $state<{ row: number; col: number } | null>(null);
	let editError = $state<string | null>(null);
	let saving = $state(false);

	function cellAt(r: number, c: number): Cell {
		const key = `${r}:${c}`;
		return key in patched ? patched[key] : rows[r][c];
	}

	function toggleSelectAll(checked: boolean) {
		selected = checked ? rows.map((_, i) => i) : [];
	}

	function toggleRow(r: number, checked: boolean) {
		selected = checked ? [...selected, r].sort((a, b) => a - b) : selected.filter((x) => x !== r);
	}

	function setHidden(name: string, hide: boolean) {
		hidden = hide ? [...hidden, name] : hidden.filter((n) => n !== name);
		onhiddenchange?.(hidden);
	}

	function canEdit(column: GridColumn): boolean {
		return !!onedit && column.editable !== false;
	}

	function startEdit(r: number, c: number) {
		if (!canEdit(columns[c])) return;
		editError = null;
		editing = { row: r, col: c };
	}

	async function save(value: string | null) {
		if (!editing || !onedit) return;
		const { row, col } = editing;
		saving = true;
		editError = null;
		try {
			const res = await onedit(row, columns[col], value);
			if (res.ok) {
				patched[`${row}:${col}`] = res.cell;
				editing = null;
			} else {
				editError = res.error;
			}
		} catch {
			editError = 'The request failed.';
		} finally {
			saving = false;
		}
	}

	const sortState = (name: string): 'ascending' | 'descending' | 'none' =>
		sort?.column === name ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
</script>

{#snippet headerCells(interactive: boolean)}
	{#if selectable}
		<Table.Head class="w-10">
			{#if interactive}
				<Checkbox
					aria-label="Select all rows"
					checked={allSelected}
					onCheckedChange={(v) => toggleSelectAll(v === true)}
				/>
			{/if}
		</Table.Head>
	{/if}
	{#if showLeft}<Table.Head class="w-px"></Table.Head>{/if}
	{#each visible as { column } (column.name)}
		{@const numeric = isNumericKind(column.kind)}
		<Table.Head
			scope="col"
			class={cn(numeric && 'text-end')}
			aria-sort={interactive ? sortState(column.name) : undefined}
			title={[column.type, column.comment].filter(Boolean).join(' - ') || undefined}
		>
			{#if interactive && column.sortable !== false && onsort}
				<button
					type="button"
					class={cn(
						'inline-flex items-center gap-1 rounded-sm font-semibold hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
						sort?.column === column.name && 'text-foreground',
						column.key === 'PRI' && 'underline decoration-dotted underline-offset-4'
					)}
					onclick={() => onsort(nextSort(sort, column.name, column.kind, order))}
				>
					{column.name}
					{#if sort?.column === column.name}
						{#if sort.dir === 'asc'}
							<ArrowUp class="size-3.5" aria-hidden="true" />
						{:else}
							<ArrowDown class="size-3.5" aria-hidden="true" />
						{/if}
					{:else}
						<ChevronsUpDown class="size-3.5 opacity-40" aria-hidden="true" />
					{/if}
				</button>
			{:else}
				<span class={cn(column.key === 'PRI' && 'underline decoration-dotted underline-offset-4')}>
					{column.name}
				</span>
			{/if}
		</Table.Head>
	{/each}
	{#if showRight}<Table.Head class="w-px"></Table.Head>{/if}
{/snippet}

<div class={cn('flex flex-col', className)} data-slot="result-grid">
	<div class="flex items-center justify-end gap-2 border-b px-3 py-2">
		{#if hasTransforms}
			<Button
				variant="outline"
				size="sm"
				aria-pressed={showRaw}
				onclick={() => (showRaw = !showRaw)}
				data-testid="toggle-raw"
			>
				<Wand class="size-4" aria-hidden="true" />
				{showRaw ? 'Show transformed values' : 'Show raw values'}
			</Button>
		{/if}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm">
						<Columns3 class="size-4" aria-hidden="true" />
						Columns
						{#if hidden.length}<span class="text-muted-foreground"
								>({columns.length - hidden.length}/{columns.length})</span
							>{/if}
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="max-h-80 overflow-auto">
				<DropdownMenu.Label>Visible columns</DropdownMenu.Label>
				<DropdownMenu.Separator />
				{#each columns as column (column.name)}
					<DropdownMenu.CheckboxItem
						checked={!hidden.includes(column.name)}
						onCheckedChange={(v) => setHidden(column.name, !v)}
					>
						{column.name}
					</DropdownMenu.CheckboxItem>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>

	{#if rows.length === 0 && empty}
		{@render empty()}
	{:else}
		<div class="max-h-[70vh] w-full overflow-auto" data-testid="result-scroll">
			<table class="w-full caption-bottom text-sm" data-slot="table">
				<Table.Header class="sticky top-0 z-10 bg-muted shadow-[0_1px_0_var(--border)]">
					<Table.Row>{@render headerCells(true)}</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows.keys() as r (r)}
						{#if repeatCells > 0 && r > 0 && r % repeatCells === 0}
							<Table.Row class="bg-muted">{@render headerCells(false)}</Table.Row>
						{/if}
						<Table.Row data-state={selected.includes(r) ? 'selected' : undefined}>
							{#if selectable}
								<Table.Cell class="w-10">
									<Checkbox
										aria-label="Select row {r + 1}"
										checked={selected.includes(r)}
										onCheckedChange={(v) => toggleRow(r, v === true)}
									/>
								</Table.Cell>
							{/if}
							{#if showLeft}
								<Table.Cell class="w-px"
									><div class="flex items-center gap-1">
										{@render actions?.({ row: r })}
									</div></Table.Cell
								>
							{/if}
							{#each visible as { column, index: c } (column.name)}
								{@const cell = cellAt(r, c)}
								{@const tv = transformedAt(r, c)}
								{@const isEditing = editing?.row === r && editing?.col === c}
								<Table.Cell
									class={cn(
										'max-w-md',
										isNumericKind(column.kind) && 'text-end tabular-nums',
										canEdit(column) && !isEditing && 'cursor-cell',
										isEditing && 'whitespace-normal'
									)}
									ondblclick={() => startEdit(r, c)}
									data-column={column.name}
								>
									{#if isEditing}
										<CellEditor
											{column}
											{cell}
											error={editError}
											{saving}
											onsave={save}
											oncancel={() => (editing = null)}
										/>
									{:else if tv}
										<TransformedValue value={tv} />
									{:else}
										<CellValue
											{cell}
											kind={column.kind}
											{limitChars}
											expanded={expanded[`${r}:${c}`] ?? false}
											ontoggle={() => (expanded[`${r}:${c}`] = !expanded[`${r}:${c}`])}
											link={links[column.name]?.[r] ?? null}
											download={downloadHref?.(r, column) ?? null}
										/>
									{/if}
								</Table.Cell>
							{/each}
							{#if showRight}
								<Table.Cell class="w-px"
									><div class="flex items-center gap-1">
										{@render actions?.({ row: r })}
									</div></Table.Cell
								>
							{/if}
						</Table.Row>
					{/each}
				</Table.Body>
			</table>
		</div>
	{/if}
</div>
