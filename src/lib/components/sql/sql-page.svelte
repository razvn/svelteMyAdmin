<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Database from '@lucide/svelte/icons/database';
	import Play from '@lucide/svelte/icons/play';
	import { tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import SqlEditor from '#lib/components/sql-editor/sql-editor.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Collapsible from '#lib/components/ui/collapsible/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Tabs from '#lib/components/ui/tabs/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { callAction } from '#lib/forms/call-action.ts';
	import { escapeId } from '#lib/sql/escape.ts';
	import { formatSeconds } from '#lib/sql/messages.ts';
	import type {
		ExecParams,
		SqlPageSettings,
		SqlRunOptions,
		SqlScope,
		StatementResult
	} from '#lib/sql/run-types.ts';
	import { queryTemplate, type TemplateName } from '#lib/sql/templates.ts';
	import BookmarkForm from './bookmark-form.svelte';
	import BookmarkList from './bookmark-list.svelte';
	import QueryHistory from './query-history.svelte';
	import StatementResultBlock from './statement-result.svelte';

	/** What the `run` action returns (see `SqlRunResult` in `#lib/server/sql/page.ts`). */
	interface RunData {
		result: {
			statements: StatementResult[];
			stopped: boolean;
			rolledBack: boolean;
			totalMs: number;
		};
		options: SqlRunOptions;
		sqlQuery: string;
		refill: boolean;
	}

	interface Props {
		/** Result of the page `load` (`loadSqlPage`). */
		data: {
			scope: SqlScope;
			prefill: string;
			tables: { name: string; columns: string[] }[];
			settings: SqlPageSettings;
		};
		/** The page `form` prop (result of the `run` action). */
		form?: unknown;
	}

	let { data, form }: Props = $props();

	const run = $derived((form as { run?: RunData } | null | undefined)?.run ?? null);
	const formError = $derived((form as { error?: string } | null | undefined)?.error ?? null);
	const scope = $derived(data.scope);
	const settings = $derived(data.settings);

	// Query box + options. Derived so a new result resets them; typing overrides until then.
	let value = $derived(run ? (run.refill ? run.sqlQuery : '') : data.prefill);
	let showQuery = $derived(run?.options.showQuery ?? true);
	let retainQueryBox = $derived(run?.options.retainQueryBox ?? settings.retainQueryBox);
	let rollback = $derived(run?.options.rollback ?? false);
	let fkChecks = $derived(run?.options.foreignKeyChecks ?? true);
	let profiling = $derived(run?.options.profiling ?? false);
	let continueOnError = $derived(run?.options.continueOnError ?? false);
	let delimiter = $derived(run?.options.delimiter ?? ';');

	let formEl = $state<HTMLFormElement>();
	let editor = $state<ReturnType<typeof SqlEditor>>();
	let running = $state(false);
	let busyIndex = $state<number | null>(null);

	// History / bookmarks panel
	let historyKey = $state(0);
	let bookmarkKey = $state(0);
	let bookmarkLabel = $state('');
	let bookmarkReplace = $state(false);
	let panelTab = $state('history');
	const bookmarkDb = $derived(scope.level === 'server' ? '' : scope.db);

	async function runBookmark(sql: string) {
		value = sql;
		await tick();
		formEl?.requestSubmit();
	}

	// Per-statement replacements (pagination, sorting, refresh) for the current result.
	let patch = $state.raw<{ base: unknown; map: Record<number, StatementResult> }>({
		base: null,
		map: {}
	});
	const statements = $derived(
		run
			? run.result.statements.map((s) => (patch.base === run ? (patch.map[s.index] ?? s) : s))
			: []
	);

	function replace(index: number, next: StatementResult) {
		const map = patch.base === run ? patch.map : {};
		patch = { base: run, map: { ...map, [index]: { ...next, index } } };
	}

	async function exec(index: number, sql: string, p: ExecParams): Promise<StatementResult | null> {
		const o: SqlRunOptions = run?.options ?? {
			showQuery,
			retainQueryBox,
			rollback,
			foreignKeyChecks: fkChecks,
			profiling,
			continueOnError,
			delimiter
		};
		const flag = (b: boolean) => (b ? '1' : '0');
		busyIndex = index;
		const res = await callAction<{ run?: RunData }>(page.url.pathname, 'run', {
			sql_query: sql,
			single: '1',
			pos: String(p.pos ?? 0),
			explain: p.explain ?? '',
			show_query: flag(o.showQuery),
			retain_query_box: flag(o.retainQueryBox),
			rollback: flag(o.rollback),
			fk_checks: flag(o.foreignKeyChecks),
			profiling: flag(p.profiling ?? o.profiling),
			continue_on_error: '0',
			delimiter: ';'
		});
		busyIndex = null;
		const stmt = res.data?.run?.result.statements[0];
		if (!res.ok || !stmt) {
			toast.error(res.message ?? 'The query could not be run.');
			return null;
		}
		return stmt;
	}

	function edit(sql: string) {
		value = sql;
		editor?.focus();
		formEl?.scrollIntoView({ block: 'start' });
	}

	function insert(text: string) {
		editor?.insertText(text);
	}

	function useTemplate(name: TemplateName) {
		if (scope.level !== 'table') return;
		value = queryTemplate(name, scope.table, data.tables[0]?.columns ?? []);
		editor?.focus();
	}

	const title = $derived(
		scope.level === 'server' ? 'SQL' : scope.level === 'db' ? 'SQL' : scope.table
	);
	const description = $derived(
		scope.level === 'server'
			? 'Run SQL query/queries on server'
			: scope.level === 'db'
				? `Run SQL query/queries on database ${scope.db}`
				: `Run SQL query/queries on table ${scope.db}.${scope.table}`
	);
	const schemaUrl = $derived(
		scope.level === 'server' ? undefined : `/api/sql/schema?db=${encodeURIComponent(scope.db)}`
	);
	const templates: { name: TemplateName; label: string }[] = [
		{ name: 'select-all', label: 'SELECT *' },
		{ name: 'select', label: 'SELECT' },
		{ name: 'insert', label: 'INSERT' },
		{ name: 'update', label: 'UPDATE' },
		{ name: 'delete', label: 'DELETE' }
	];
</script>

<svelte:head>
	<title>SQL - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6 p-4 md:p-6">
	<PageHeader {title} {description} icon={Database} />

	<Card.Root class="gap-0 py-0">
		<form
			method="POST"
			action="?/run"
			class="flex flex-col gap-4 p-4"
			bind:this={formEl}
			data-testid="sql-form"
			use:enhance={() => {
				running = true;
				return async ({ update }) => {
					running = false;
					await update({ reset: false });
					historyKey++;
				};
			}}
		>
			<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
				<div class="flex min-w-0 flex-col gap-2">
					<SqlEditor
						bind:this={editor}
						bind:value
						name="sql_query"
						aria-label="SQL query"
						dialect={settings.dialect}
						{schemaUrl}
						minLines={8}
						placeholder="Run SQL query"
						onrun={() => formEl?.requestSubmit()}
					/>
					<div class="flex flex-wrap items-center gap-2">
						{#if scope.level === 'table'}
							{#each templates as t (t.name)}
								<Button
									type="button"
									variant="outline"
									size="sm"
									onclick={() => useTemplate(t.name)}>{t.label}</Button
								>
							{/each}
						{/if}
						<Button type="button" variant="ghost" size="sm" onclick={() => (value = '')}
							>Clear</Button
						>
						<Button type="button" variant="ghost" size="sm" onclick={() => editor?.format()}
							>Format</Button
						>
					</div>
				</div>

				{#if data.tables.length}
					<div class="min-w-0 rounded-lg border" data-testid="sql-columns">
						<p class="border-b px-3 py-2 text-sm font-medium">
							{scope.level === 'table' ? 'Columns' : 'Tables'}
						</p>
						<div class="max-h-64 overflow-auto p-1">
							{#if scope.level === 'table'}
								{#each data.tables[0].columns as c (c)}
									<button
										type="button"
										class="block w-full truncate rounded px-2 py-1 text-start font-mono text-xs hover:bg-muted"
										title="Insert {escapeId(c)}"
										onclick={() => insert(escapeId(c))}>{c}</button
									>
								{/each}
							{:else}
								{#each data.tables as t (t.name)}
									<Collapsible.Root>
										<Collapsible.Trigger
											class="block w-full truncate rounded px-2 py-1 text-start text-xs font-medium hover:bg-muted"
											>{t.name}</Collapsible.Trigger
										>
										<Collapsible.Content class="ps-3">
											<button
												type="button"
												class="block w-full truncate rounded px-2 py-1 text-start font-mono text-xs text-primary hover:bg-muted"
												onclick={() => insert(escapeId(t.name))}>insert {escapeId(t.name)}</button
											>
											{#each t.columns as c (c)}
												<button
													type="button"
													class="block w-full truncate rounded px-2 py-1 text-start font-mono text-xs hover:bg-muted"
													onclick={() => insert(escapeId(c))}>{c}</button
												>
											{/each}
										</Collapsible.Content>
									</Collapsible.Root>
								{/each}
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
				<div class="flex items-center gap-2">
					<Checkbox id="opt-show-query" name="show_query" value="1" bind:checked={showQuery} />
					<Label for="opt-show-query">Show this query here again</Label>
				</div>
				<div class="flex items-center gap-2">
					<Checkbox
						id="opt-retain"
						name="retain_query_box"
						value="1"
						bind:checked={retainQueryBox}
					/>
					<Label for="opt-retain">Retain query box</Label>
				</div>
				<div class="flex items-center gap-2">
					<Checkbox id="opt-rollback" name="rollback" value="1" bind:checked={rollback} />
					<Label for="opt-rollback">Rollback when finished</Label>
				</div>
				<div class="flex items-center gap-2">
					<Checkbox id="opt-fk" name="fk_checks" value="1" bind:checked={fkChecks} />
					<Label for="opt-fk">Enable foreign key checks</Label>
				</div>
				<div class="flex items-center gap-2">
					<Checkbox id="opt-profiling" name="profiling" value="1" bind:checked={profiling} />
					<Label for="opt-profiling">Profiling</Label>
				</div>
				<div class="flex items-center gap-2">
					<Checkbox
						id="opt-continue"
						name="continue_on_error"
						value="1"
						bind:checked={continueOnError}
					/>
					<Label for="opt-continue">Continue on error</Label>
				</div>
				<div class="flex items-center gap-2">
					<Label for="opt-delimiter">Delimiter</Label>
					<Input
						id="opt-delimiter"
						name="delimiter"
						class="w-16 font-mono"
						maxlength={16}
						bind:value={delimiter}
					/>
				</div>
				<Button type="submit" class="ms-auto" disabled={running}>
					<Play class="size-4" aria-hidden="true" />Go
				</Button>
			</div>
		</form>
	</Card.Root>

	<Card.Root class="gap-0 py-0" data-testid="sql-extras">
		<Tabs.Root bind:value={panelTab} class="gap-0 p-4">
			<Tabs.List>
				<Tabs.Trigger value="history">SQL history</Tabs.Trigger>
				<Tabs.Trigger value="bookmarks">Bookmarks</Tabs.Trigger>
				<Tabs.Trigger value="bookmark-save">Bookmark this SQL query</Tabs.Trigger>
			</Tabs.List>
			<Tabs.Content value="history" class="pt-3">
				<QueryHistory
					refreshKey={historyKey}
					onload={(sql) => {
						value = sql;
						editor?.focus();
					}}
				/>
			</Tabs.Content>
			<Tabs.Content value="bookmarks" class="pt-3">
				<BookmarkList
					db={bookmarkDb}
					refreshKey={bookmarkKey}
					onload={(sql, b) => {
						value = sql;
						bookmarkLabel = b.label;
						bookmarkReplace = true;
						editor?.focus();
					}}
					onrun={runBookmark}
				/>
			</Tabs.Content>
			<Tabs.Content value="bookmark-save" class="pt-3">
				<BookmarkForm
					db={bookmarkDb}
					sql={value}
					bind:label={bookmarkLabel}
					bind:replace={bookmarkReplace}
					oncreated={() => {
						bookmarkKey++;
						panelTab = 'bookmarks';
					}}
				/>
			</Tabs.Content>
		</Tabs.Root>
	</Card.Root>

	{#if formError}
		<Alert variant="destructive" data-testid="sql-form-error">
			<AlertDescription>{formError}</AlertDescription>
		</Alert>
	{/if}

	{#if run}
		<section class="flex flex-col gap-4" aria-label="Results" data-testid="sql-results">
			{#if run.result.rolledBack}
				<Alert variant="info" data-testid="rolled-back">
					<AlertDescription
						>The transaction was rolled back; DDL statements may have been committed implicitly.</AlertDescription
					>
				</Alert>
			{/if}
			{#if run.result.stopped}
				<Alert variant="warning">
					<AlertDescription>Execution stopped at the first error.</AlertDescription>
				</Alert>
			{/if}
			{#each statements as s (s.index)}
				<StatementResultBlock
					statement={s}
					{scope}
					{settings}
					busy={busyIndex === s.index}
					onedit={edit}
					exec={(sql, p) => exec(s.index, sql, p)}
					onreplace={(next) => replace(s.index, next)}
				/>
			{/each}
			{#if statements.length > 1}
				<p class="text-sm text-muted-foreground">
					{statements.length} statements, {formatSeconds(run.result.totalMs)} seconds.
				</p>
			{/if}
		</section>
	{/if}
</div>
