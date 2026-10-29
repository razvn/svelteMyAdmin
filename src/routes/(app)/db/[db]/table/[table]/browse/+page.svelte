<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- hrefs are built from db/table names and signed query strings */
	import { enhance } from '$app/forms';
	import { goto, refreshAll } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronsLeft from '@lucide/svelte/icons/chevrons-left';
	import ChevronsRight from '@lucide/svelte/icons/chevrons-right';
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import FilterX from '@lucide/svelte/icons/filter-x';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Table2 from '@lucide/svelte/icons/table-2';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import ResultGrid from '#lib/components/results/result-grid.svelte';
	import type { EditResult, GridColumn } from '#lib/components/results/types.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Collapsible from '#lib/components/ui/collapsible/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { callAction } from '#lib/forms/call-action.ts';
	import { formatNumber } from '#lib/format.ts';
	import { pageChoices } from '#lib/table/pagination.ts';
	import type { Sort } from '#lib/table/sort.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const tableBase = $derived(
		`/db/${encodeURIComponent(data.db)}/table/${encodeURIComponent(data.table)}`
	);
	const gridColumns = $derived<GridColumn[]>(data.columns);
	const gridRows = $derived(data.rows.map((r) => r.cells));
	const editable = $derived(
		!data.isView && data.hasUniqueKey && data.settings.gridEditing !== 'disabled'
	);
	const showActions = $derived(!data.isView && data.settings.rowActionLinks !== 'none');
	const showText = $derived(data.settings.rowActionType !== 'icons');
	const showIcons = $derived(data.settings.rowActionType !== 'text');

	let hidden = $derived(data.hidden);
	let selected = $state<number[]>([]);
	$effect(() => {
		void data.rows;
		selected = [];
	});

	let sqlOpen = $state(false);
	let deleting = $state<number[] | null>(null);
	let deleteForm = $state<HTMLFormElement>();
	let deleteBusy = $state(false);
	let deleteError = $state('');

	// ---- navigation --------------------------------------------------------------------------
	function go(change: Record<string, string | null>) {
		const url = new URL(page.url.href);
		for (const [k, v] of Object.entries(change)) {
			if (v === null) url.searchParams.delete(k);
			else url.searchParams.set(k, v);
		}
		void goto(url, { reset: false });
	}
	const goToPos = (pos: number) => go({ pos: pos === 0 ? null : String(pos) });
	const onsort = (sort: Sort | null) =>
		go({ sort: sort?.column ?? '', dir: sort?.dir ?? null, pos: null });

	const pages = $derived(pageChoices(data.page.pages, data.page.page));

	// ---- row links ---------------------------------------------------------------------------
	function rowQuery(indexes: number[], extra: Record<string, string> = {}): string {
		const q = new SvelteURLSearchParams();
		for (const i of indexes) {
			q.append('where', data.rows[i].where);
			q.append('sig', data.rows[i].sig);
		}
		for (const [k, v] of Object.entries(extra)) q.set(k, v);
		return q.toString();
	}
	const editHref = (idx: number[]) => `${tableBase}/insert?${rowQuery(idx)}`;
	const copyHref = (idx: number[]) => `${tableBase}/insert?${rowQuery(idx, { copy: '1' })}`;
	const exportHref = (idx: number[]) => `${tableBase}/export?${rowQuery(idx)}`;

	const quote = (name: string) => '`' + name.replaceAll('`', '``') + '`';
	const deleteSql = (i: number) =>
		`DELETE FROM ${quote(data.db)}.${quote(data.table)} WHERE ${data.rows[i].where} LIMIT 1;`;

	function downloadHref(row: number, column: GridColumn): string | null {
		if (column.kind !== 'binary') return null;
		const q = new URLSearchParams({
			where: data.rows[row].where,
			sig: data.rows[row].sig,
			col: column.name
		});
		return `${tableBase}/browse/download?${q}`;
	}

	// ---- inline edit / prefs -----------------------------------------------------------------
	async function onedit(
		row: number,
		column: GridColumn,
		value: string | null
	): Promise<EditResult> {
		const r = data.rows[row];
		const res = await callAction<{
			cell: EditResult extends { ok: true; cell: infer C } ? C : never;
			keyChanged: boolean;
		}>(page.url.pathname, 'update', {
			where: r.where,
			sig: r.sig,
			column: column.name,
			value: value ?? '',
			isNull: value === null ? '1' : '0'
		});
		if (!res.ok || !res.data) return { ok: false, error: res.message ?? 'Update failed.' };
		toast.success(`Column ${column.name} updated`);
		// A changed key invalidates the signed links of the row: reload the page data.
		if (res.data.keyChanged) void refreshAll();
		return { ok: true, cell: res.data.cell };
	}

	function onhiddenchange(next: string[]) {
		hidden = next;
		void callAction(page.url.pathname, 'prefs', { hidden: JSON.stringify(next) });
	}

	// ---- delete ------------------------------------------------------------------------------
	function askDelete(indexes: number[]) {
		deleteError = '';
		deleting = indexes;
	}
</script>

<svelte:head>
	<title>Browse - {data.table} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6 p-4 md:p-6">
	<PageHeader
		title={data.table}
		description={data.isView ? 'Browse view (read-only)' : 'Browse data'}
		icon={Table2}
	>
		{#snippet actions()}
			{#if data.columns.some((c) => c.kind === 'geometry')}
				<Button href="{tableBase}/gis" size="sm" variant="outline">Visualize GIS data</Button>
			{/if}
			{#if !data.isView}
				<Button href="{tableBase}/insert" size="sm">
					<Plus class="size-4" aria-hidden="true" />
					Insert
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.queryError}
		<Alert variant="destructive" data-testid="query-error">
			<AlertDescription>{data.queryError}</AlertDescription>
		</Alert>
	{/if}

	<Card.Root class="gap-0 py-0">
		<div
			class="flex flex-wrap items-center justify-between gap-3 border-b p-4"
			data-testid="browse-toolbar"
		>
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<p data-testid="rows-message">
					{#if data.page.to === 0}
						Showing no rows
					{:else}
						Showing rows {formatNumber(data.page.from - 1)} - {formatNumber(data.page.to - 1)}
					{/if}
					<span class="text-muted-foreground">
						({data.approx ? '~' : ''}{formatNumber(data.total)} total, Query took {data.seconds.toFixed(
							4
						)}
						seconds.)
					</span>
				</p>
				{#if data.filter}
					<Badge variant="info" data-testid="filter-badge">Filtered</Badge>
					<a
						class="inline-flex items-center gap-1 text-primary hover:underline"
						href={data.clearFilterHref}
					>
						<FilterX class="size-3.5" aria-hidden="true" />
						Clear filter
					</a>
				{/if}
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<div class="flex items-center gap-1" role="navigation" aria-label="Pagination">
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="First page"
						disabled={data.page.prevPos === null}
						onclick={() => goToPos(data.page.firstPos)}><ChevronsLeft class="size-4" /></Button
					>
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Previous page"
						disabled={data.page.prevPos === null}
						onclick={() => goToPos(data.page.prevPos ?? 0)}><ChevronLeft class="size-4" /></Button
					>
					<Select.Root
						type="single"
						value={String(data.page.page)}
						onValueChange={(v) => goToPos((Number(v) - 1) * data.page.size)}
					>
						<Select.Trigger size="sm" class="w-28" aria-label="Page">
							Page {data.page.page} / {data.page.pages}
						</Select.Trigger>
						<Select.Content class="max-h-72">
							{#each pages as p (p)}
								<Select.Item value={String(p)} label="Page {p}">{p}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Next page"
						disabled={data.page.nextPos === null}
						onclick={() => goToPos(data.page.nextPos ?? 0)}><ChevronRight class="size-4" /></Button
					>
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Last page"
						disabled={data.page.nextPos === null}
						onclick={() => goToPos(data.page.lastPos)}><ChevronsRight class="size-4" /></Button
					>
				</div>

				<Select.Root
					type="single"
					value={String(data.rowsPerPage)}
					onValueChange={(v) => go({ rows: v, pos: null })}
				>
					<Select.Trigger size="sm" class="w-36" aria-label="Rows per page">
						{data.rowsPerPage === 'all' ? 'Show all' : `${data.rowsPerPage} rows`}
					</Select.Trigger>
					<Select.Content>
						{#each data.rowsOptions as n (n)}
							<Select.Item value={String(n)} label="{n} rows">{n} rows</Select.Item>
						{/each}
						{#if data.showAllAllowed}
							<Select.Item value="all" label="Show all">Show all</Select.Item>
						{/if}
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		{#if data.total === 0 && !data.queryError}
			<div
				class="flex flex-col items-center gap-3 px-6 py-16 text-center"
				data-testid="empty-state"
			>
				<span
					class="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary"
				>
					<Table2 class="size-6" aria-hidden="true" />
				</span>
				{#if data.filter}
					<p class="font-medium">No rows match the filter.</p>
					<Button href={data.clearFilterHref} variant="outline" size="sm">Clear filter</Button>
				{:else}
					<p class="font-medium">This {data.isView ? 'view' : 'table'} has no rows yet.</p>
					{#if !data.isView}
						<Button href="{tableBase}/insert" size="sm">
							<Plus class="size-4" aria-hidden="true" />
							Insert a row
						</Button>
					{/if}
				{/if}
			</div>
		{:else}
			<ResultGrid
				columns={gridColumns}
				rows={gridRows}
				limitChars={data.settings.limitChars}
				sort={data.sort}
				order={data.settings.order}
				{onsort}
				{hidden}
				{onhiddenchange}
				selectable={!data.isView}
				bind:selected
				actionsPosition={showActions ? data.settings.rowActionLinks : 'none'}
				repeatCells={data.settings.repeatCells}
				links={data.fkLinks}
				transforms={data.transforms}
				{downloadHref}
				onedit={editable ? onedit : undefined}
			>
				{#snippet actions({ row })}
					<Button
						variant="ghost"
						size={showText ? 'sm' : 'icon-sm'}
						href={editHref([row])}
						aria-label="Edit row {row + 1}"
					>
						{#if showIcons}<Pencil class="size-4" aria-hidden="true" />{/if}
						{#if showText}Edit{/if}
					</Button>
					<Button
						variant="ghost"
						size={showText ? 'sm' : 'icon-sm'}
						href={copyHref([row])}
						aria-label="Copy row {row + 1}"
					>
						{#if showIcons}<Copy class="size-4" aria-hidden="true" />{/if}
						{#if showText}Copy{/if}
					</Button>
					<Button
						variant="ghost"
						size={showText ? 'sm' : 'icon-sm'}
						class="text-destructive hover:text-destructive"
						aria-label="Delete row {row + 1}"
						onclick={() => askDelete([row])}
					>
						{#if showIcons}<Trash2 class="size-4" aria-hidden="true" />{/if}
						{#if showText}Delete{/if}
					</Button>
				{/snippet}
			</ResultGrid>

			{#if !data.isView}
				<div
					class="flex flex-wrap items-center gap-2 border-t p-3 text-sm"
					data-testid="with-selected"
				>
					<span class="text-muted-foreground">With selected ({selected.length}):</span>
					<Button
						variant="outline"
						size="sm"
						href={selected.length ? editHref(selected) : undefined}
						disabled={!selected.length}><Pencil class="size-4" aria-hidden="true" />Edit</Button
					>
					<Button
						variant="outline"
						size="sm"
						href={selected.length ? copyHref(selected) : undefined}
						disabled={!selected.length}><Copy class="size-4" aria-hidden="true" />Copy</Button
					>
					<Button
						variant="outline"
						size="sm"
						class="text-destructive"
						disabled={!selected.length}
						onclick={() => askDelete(selected)}
						><Trash2 class="size-4" aria-hidden="true" />Delete</Button
					>
					<Button
						variant="outline"
						size="sm"
						href={selected.length ? exportHref(selected) : undefined}
						disabled={!selected.length}><Download class="size-4" aria-hidden="true" />Export</Button
					>
				</div>
			{/if}
		{/if}
	</Card.Root>

	<Collapsible.Root bind:open={sqlOpen}>
		<Collapsible.Trigger
			class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
		>
			<ChevronDown
				class={['size-4 transition-transform', !sqlOpen && '-rotate-90']}
				aria-hidden="true"
			/>
			SQL query
		</Collapsible.Trigger>
		<Collapsible.Content>
			<pre
				class="mt-2 overflow-auto rounded-xl border bg-card p-4 font-mono text-xs whitespace-pre-wrap"
				data-testid="browse-sql">{data.sql}</pre>
		</Collapsible.Content>
	</Collapsible.Root>
</div>

<AlertDialog.Root
	open={deleting !== null}
	onOpenChange={(o) => {
		if (!o) deleting = null;
	}}
>
	<AlertDialog.Content class="sm:max-w-xl">
		<AlertDialog.Header>
			<AlertDialog.Title
				>Delete {deleting?.length === 1
					? 'this row'
					: `${deleting?.length ?? 0} rows`}?</AlertDialog.Title
			>
			<AlertDialog.Description
				>The following queries will be executed. This cannot be undone.</AlertDialog.Description
			>
		</AlertDialog.Header>
		<pre
			class="max-h-60 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
			data-testid="confirm-sql">{(deleting ?? []).map(deleteSql).join('\n')}</pre>
		{#if deleteError}
			<p class="text-sm text-destructive" role="alert">{deleteError}</p>
		{/if}
		<form
			method="POST"
			action="?/delete"
			bind:this={deleteForm}
			use:enhance={() => {
				deleteBusy = true;
				return async ({ result, update }) => {
					deleteBusy = false;
					if (result.type === 'success') {
						const n = (result.data as { deleted?: number } | undefined)?.deleted ?? 0;
						toast.success(`${n} row${n === 1 ? '' : 's'} deleted`);
						deleting = null;
						await update();
					} else if (result.type === 'failure') {
						deleteError = String(
							(result.data as { error?: string } | undefined)?.error ?? 'Delete failed.'
						);
					} else {
						await update();
					}
				};
			}}
		>
			{#each deleting ?? [] as i (i)}
				<input type="hidden" name="where" value={data.rows[i].where} />
				<input type="hidden" name="sig" value={data.rows[i].sig} />
			{/each}
		</form>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				disabled={deleteBusy}
				onclick={(e: MouseEvent) => {
					e.preventDefault();
					deleteForm?.requestSubmit();
				}}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
