<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronsLeft from '@lucide/svelte/icons/chevrons-left';
	import ChevronsRight from '@lucide/svelte/icons/chevrons-right';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import { toast } from 'svelte-sonner';
	import { getNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import ResultGrid from '#lib/components/results/result-grid.svelte';
	import type { GridColumn } from '#lib/components/results/types.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { callAction } from '#lib/forms/call-action.ts';
	import {
		EMPTY_RESULT_MESSAGE,
		SUCCESS_MESSAGE,
		affectedRowsMessage,
		errorMessage,
		queryTook,
		showingRowsMessage,
		truncateSql
	} from '#lib/sql/messages.ts';
	import { analyzeSimpleSelect, applySort, isSortableField } from '#lib/sql/result-sort.ts';
	import type {
		ExecParams,
		ResultSetData,
		SqlPageSettings,
		SqlScope,
		StatementResult
	} from '#lib/sql/run-types.ts';
	import type { Sort } from '#lib/table/sort.ts';
	import ChartDialog from './chart-dialog.svelte';
	import CreateViewDialog from './create-view-dialog.svelte';

	interface Props {
		statement: StatementResult;
		scope: SqlScope;
		settings: SqlPageSettings;
		/** Put the statement back into the query box. */
		onedit: (sql: string) => void;
		/** Run one statement again (nothing is replaced). */
		exec: (sql: string, params: ExecParams) => Promise<StatementResult | null>;
		/** Replace this block's result (pagination, sorting, refresh, profiling, row deletion). */
		onreplace: (next: StatementResult) => void;
		busy?: boolean;
	}

	let { statement, scope, settings, onedit, exec, onreplace, busy = false }: Props = $props();

	const enc = encodeURIComponent;
	const base = $derived(
		scope.level === 'server'
			? '/server'
			: scope.level === 'db'
				? `/db/${enc(scope.db)}`
				: `/db/${enc(scope.db)}/table/${enc(scope.table)}`
	);
	const exportHref = $derived(`${base}/export?sql_query=${enc(statement.sql)}`);

	let expandedSql = $state(false);
	const shown = $derived(truncateSql(statement.sql, settings.maxCharsInSql));

	const simple = $derived(
		statement.ok && statement.kind === 'select' && statement.resultSets.length === 1
			? analyzeSimpleSelect(statement.sql)
			: null
	);

	// ---- SQL display with the failing part marked -------------------------------------------
	const sqlParts = $derived.by(() => {
		const text = expandedSql ? statement.sql : shown.text;
		const r = !statement.ok ? statement.errorRange : null;
		if (!r) return { before: text, mark: '', after: '' };
		const start = Math.min(r.start, text.length);
		const end = Math.min(r.end, text.length);
		return { before: text.slice(0, start), mark: text.slice(start, end), after: text.slice(end) };
	});

	// ---- grid mapping ------------------------------------------------------------------------
	function gridColumns(set: ResultSetData, sortable: boolean): GridColumn[] {
		const seen: Record<string, number> = {};
		const counts: Record<string, number> = {};
		for (const f of set.fields) counts[f.name] = (counts[f.name] ?? 0) + 1;
		return set.fields.map((f) => {
			const n = (seen[f.name] ?? 0) + 1;
			seen[f.name] = n;
			return {
				name: n > 1 ? `${f.name} (${n})` : f.name,
				type: f.type,
				kind: f.kind,
				key: f.key,
				nullable: f.nullable,
				editable: false,
				sortable: sortable && counts[f.name] === 1 && isSortableField(f.name, f.orgName)
			};
		});
	}

	async function onsort(sort: Sort | null) {
		const sql = applySort(statement.sql, sort);
		if (sql === null) return;
		const next = await exec(sql, { pos: 0 });
		if (next) onreplace(next);
	}

	async function goTo(pos: number) {
		const next = await exec(statement.sql, { pos });
		if (next) onreplace(next);
	}

	async function refresh(params: ExecParams = {}) {
		const next = await exec(statement.sql, {
			pos: statement.ok ? (statement.pagination?.pos ?? 0) : 0,
			...params
		});
		if (next) onreplace(next);
	}

	// ---- chart / create view -----------------------------------------------------------------
	let chartOpen = $state(false);
	let viewOpen = $state(false);
	const chartSet = $derived(
		statement.ok && statement.resultSets[0]?.rows.length ? statement.resultSets[0] : null
	);
	let navState: ReturnType<typeof getNavState> | undefined;
	try {
		navState = getNavState();
	} catch {
		// rendered outside the app layout (component tests)
	}

	async function viewCreated(name: string) {
		toast.success(`View ${name} has been created`);
		await refreshAll();
		await navState?.reload();
	}

	// ---- explain -----------------------------------------------------------------------------
	let explained = $state.raw<{ format: 'traditional' | 'tree'; result: StatementResult } | null>(
		null
	);
	async function explain(format: 'traditional' | 'tree') {
		const result = await exec(statement.sql, { explain: format });
		if (result) explained = { format, result };
	}

	// ---- row actions -------------------------------------------------------------------------
	let deleting = $state<{ set: ResultSetData; row: number } | null>(null);
	let deleteError = $state('');
	let deleteBusy = $state(false);

	function rowQuery(set: ResultSetData, row: number): string {
		const k = set.keys?.[row];
		return k ? `where=${enc(k.where)}&sig=${enc(k.sig)}` : '';
	}
	const tableBase = (set: ResultSetData) =>
		set.source ? `/db/${enc(set.source.db)}/table/${enc(set.source.table)}` : '';

	async function confirmDelete() {
		if (!deleting) return;
		const { set, row } = deleting;
		const key = set.keys?.[row];
		if (!key) return;
		deleteBusy = true;
		deleteError = '';
		const res = await callAction(`${tableBase(set)}/browse`, 'delete', {
			where: key.where,
			sig: key.sig
		});
		deleteBusy = false;
		if (!res.ok) {
			deleteError = res.message ?? 'Delete failed.';
			return;
		}
		deleting = null;
		toast.success('Row deleted');
		await refresh();
		void refreshAll();
	}

	const deleteSql = $derived(
		deleting?.set.source && deleting.set.keys
			? `DELETE FROM \`${deleting.set.source.db}\`.\`${deleting.set.source.table}\` WHERE ${deleting.set.keys[deleting.row].where} LIMIT 1;`
			: ''
	);
</script>

{#snippet pager(p: NonNullable<Extract<StatementResult, { ok: true }>['pagination']>)}
	{@const last = p.total === null ? null : Math.max(0, Math.floor((p.total - 1) / p.size) * p.size)}
	<div class="flex items-center gap-1" role="navigation" aria-label="Pagination">
		<Button
			variant="outline"
			size="icon-sm"
			aria-label="First page"
			disabled={busy || p.pos === 0}
			onclick={() => goTo(0)}><ChevronsLeft class="size-4" aria-hidden="true" /></Button
		>
		<Button
			variant="outline"
			size="icon-sm"
			aria-label="Previous page"
			disabled={busy || p.pos === 0}
			onclick={() => goTo(Math.max(0, p.pos - p.size))}
			><ChevronLeft class="size-4" aria-hidden="true" /></Button
		>
		<Button
			variant="outline"
			size="icon-sm"
			aria-label="Next page"
			disabled={busy || !p.hasMore}
			onclick={() => goTo(p.pos + p.size)}
			><ChevronRight class="size-4" aria-hidden="true" /></Button
		>
		<Button
			variant="outline"
			size="icon-sm"
			aria-label="Last page"
			disabled={busy || last === null || !p.hasMore}
			onclick={() => goTo(last ?? 0)}><ChevronsRight class="size-4" aria-hidden="true" /></Button
		>
	</div>
{/snippet}

{#snippet resultTable(set: ResultSetData, interactive: boolean)}
	{@const sortable = interactive && !!simple}
	{#snippet rowActions({ row }: { row: number })}
		<Button
			variant="ghost"
			size="sm"
			href="{tableBase(set)}/insert?{rowQuery(set, row)}"
			aria-label="Edit row {row + 1}"
		>
			<Pencil class="size-4" aria-hidden="true" />Edit
		</Button>
		<Button
			variant="ghost"
			size="sm"
			class="text-destructive hover:text-destructive"
			aria-label="Delete row {row + 1}"
			onclick={() => {
				deleteError = '';
				deleting = { set, row };
			}}
		>
			<Trash2 class="size-4" aria-hidden="true" />Delete
		</Button>
	{/snippet}
	<ResultGrid
		columns={gridColumns(set, sortable)}
		rows={set.rows}
		transforms={set.transforms}
		limitChars={settings.limitChars}
		order={settings.order}
		sort={sortable ? simple!.sort : null}
		onsort={sortable ? onsort : undefined}
		actions={interactive && set.keys ? rowActions : undefined}
		actionsPosition="left"
	>
		{#snippet empty()}
			<p class="p-4 text-sm text-muted-foreground">{EMPTY_RESULT_MESSAGE}</p>
		{/snippet}
	</ResultGrid>
{/snippet}

<Card.Root class="gap-0 py-0" data-testid="statement-result" data-index={statement.index}>
	<div class="flex flex-col gap-3 p-4">
		{#if statement.ok}
			{@const first = statement.resultSets[0]}
			<Alert variant="success" data-testid="statement-message">
				<AlertDescription>
					{#if first}
						{#if first.rows.length === 0}
							{EMPTY_RESULT_MESSAGE} ({queryTook(statement.durationMs)})
						{:else}
							{@const from = statement.pagination?.pos ?? 0}
							{showingRowsMessage({
								from,
								to: from + first.rows.length - 1,
								total:
									statement.pagination?.total ?? (statement.pagination ? null : first.rows.length),
								ms: statement.durationMs
							})}
						{/if}
						{#if first.truncated}
							<Badge variant="warning" class="ms-2">Result truncated</Badge>
						{/if}
					{:else if statement.kind === 'dml' || statement.affectedRows > 0}
						{affectedRowsMessage(statement.affectedRows)} ({queryTook(statement.durationMs)})
						{#if statement.insertId}Inserted row id: {statement.insertId}{/if}
					{:else}
						{SUCCESS_MESSAGE} ({queryTook(statement.durationMs)})
					{/if}
				</AlertDescription>
			</Alert>
		{:else}
			<Alert variant="destructive" data-testid="statement-error">
				<AlertDescription>
					<strong>Error</strong>
					{errorMessage(statement.error.errno, statement.error.message)}
				</AlertDescription>
			</Alert>
		{/if}

		{#if settings.showSql}
			<div>
				<pre
					class="max-h-72 overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
					data-testid="statement-sql">{sqlParts.before}{#if sqlParts.mark}<mark
							class="rounded bg-destructive-soft px-0.5 text-destructive">{sqlParts.mark}</mark
						>{/if}{sqlParts.after}</pre>
				{#if shown.truncated}
					<button
						type="button"
						class="mt-1 text-xs text-primary hover:underline"
						onclick={() => (expandedSql = !expandedSql)}
					>
						{expandedSql ? 'Show less' : 'Show full query'}
					</button>
				{/if}
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-2 text-sm" data-testid="statement-actions">
			{#if settings.sqlQuery.Edit}
				<Button variant="outline" size="sm" onclick={() => onedit(statement.sql)}>
					<Pencil class="size-4" aria-hidden="true" />Edit
				</Button>
			{/if}
			{#if statement.ok && (statement.kind === 'select' || statement.kind === 'dml') && settings.sqlQuery.Explain}
				<Button variant="outline" size="sm" disabled={busy} onclick={() => explain('traditional')}>
					Explain SQL
				</Button>
			{/if}
			{#if settings.sqlQuery.Refresh && statement.ok && statement.resultSets.length > 0}
				<Button variant="outline" size="sm" disabled={busy} onclick={() => refresh()}>
					Refresh
				</Button>
			{/if}
			{#if statement.ok && settings.profilingAvailable && !statement.profile}
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onclick={() => refresh({ profiling: true })}>Profiling</Button
				>
			{/if}
			{#if statement.ok && statement.kind === 'select'}
				<Button variant="outline" size="sm" href={exportHref}>Export</Button>
				{#if scope.level !== 'server'}
					<Button variant="outline" size="sm" onclick={() => (viewOpen = true)}>Create view</Button>
				{/if}
			{/if}
			{#if chartSet}
				<Button variant="outline" size="sm" onclick={() => (chartOpen = true)}>
					<ChartColumn class="size-4" aria-hidden="true" />Display chart
				</Button>
			{/if}
		</div>

		{#if statement.ok && statement.warnings.length}
			<div data-testid="statement-warnings" class="rounded-lg border p-3 text-sm">
				<p class="mb-1 font-medium">
					<Badge variant="warning">{statement.warnings.length}</Badge> warning{statement.warnings
						.length === 1
						? ''
						: 's'}
				</p>
				<ul class="space-y-0.5 text-muted-foreground">
					{#each statement.warnings as w, i (i)}
						<li>{w.level} #{w.code}: {w.message}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if statement.ok && statement.profile}
			<div class="rounded-lg border" data-testid="statement-profile">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Status</Table.Head>
							<Table.Head class="text-end">Time (s)</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each statement.profile as p, i (i)}
							<Table.Row>
								<Table.Cell>{p.status}</Table.Cell>
								<Table.Cell class="text-end tabular-nums">{p.duration}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}

		{#if explained}
			<div class="rounded-lg border" data-testid="statement-explain">
				<div class="flex items-center gap-2 border-b p-2 text-sm">
					<span class="font-medium">Explain</span>
					<Button
						variant={explained.format === 'traditional' ? 'secondary' : 'ghost'}
						size="sm"
						onclick={() => explain('traditional')}>Table</Button
					>
					{#if settings.explainTree}
						<Button
							variant={explained.format === 'tree' ? 'secondary' : 'ghost'}
							size="sm"
							onclick={() => explain('tree')}>Tree</Button
						>
					{/if}
					<Button variant="ghost" size="sm" class="ms-auto" onclick={() => (explained = null)}
						>Close</Button
					>
				</div>
				{#if explained.result.ok}
					{#if explained.format === 'tree'}
						<pre class="overflow-auto p-3 font-mono text-xs">{explained.result.resultSets[0]?.rows
								.map((r) => r[0])
								.join('\n')}</pre>
					{:else if explained.result.resultSets[0]}
						{@render resultTable(explained.result.resultSets[0], false)}
					{/if}
				{:else}
					<p class="p-3 text-sm text-destructive">
						{errorMessage(explained.result.error.errno, explained.result.error.message)}
					</p>
				{/if}
			</div>
		{/if}
	</div>

	{#if statement.ok}
		{#each statement.resultSets as set, k (k)}
			<div class="border-t" data-testid="result-set">
				{#if statement.resultSets.length > 1}
					<p class="px-4 pt-3 text-sm font-medium">
						Result set {k + 1}
						<span class="font-normal text-muted-foreground"
							>({set.rows.length} row{set.rows.length === 1 ? '' : 's'})</span
						>
					</p>
				{/if}
				{#if k === 0 && statement.pagination && (statement.pagination.pos > 0 || statement.pagination.hasMore)}
					<div class="flex justify-end px-4 pt-3">{@render pager(statement.pagination)}</div>
				{/if}
				{@render resultTable(set, k === 0)}
				{#if k === 0 && statement.pagination && (statement.pagination.pos > 0 || statement.pagination.hasMore)}
					<div class="flex justify-end border-t px-4 py-3">
						{@render pager(statement.pagination)}
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</Card.Root>

<AlertDialog.Root
	open={deleting !== null}
	onOpenChange={(o) => {
		if (!o) deleting = null;
	}}
>
	<AlertDialog.Content class="sm:max-w-xl">
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this row?</AlertDialog.Title>
			<AlertDialog.Description
				>The following query will be executed. This cannot be undone.</AlertDialog.Description
			>
		</AlertDialog.Header>
		<pre
			class="max-h-60 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{deleteSql}</pre>
		{#if deleteError}<p class="text-sm text-destructive" role="alert">{deleteError}</p>{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				disabled={deleteBusy}
				onclick={(e: MouseEvent) => {
					e.preventDefault();
					void confirmDelete();
				}}>Delete</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

{#if chartSet}
	<ChartDialog bind:open={chartOpen} result={chartSet} />
{/if}
{#if scope.level !== 'server'}
	<CreateViewDialog
		bind:open={viewOpen}
		db={scope.db}
		query={statement.sql}
		oncreated={viewCreated}
	/>
{/if}
