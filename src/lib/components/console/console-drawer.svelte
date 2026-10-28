<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Play from '@lucide/svelte/icons/play';
	import X from '@lucide/svelte/icons/x';
	import { onMount, tick } from 'svelte';
	import BookmarkList from '#lib/components/sql/bookmark-list.svelte';
	import QueryHistory from '#lib/components/sql/query-history.svelte';
	import SqlEditor from '#lib/components/sql-editor/sql-editor.svelte';
	import { cellText } from '#lib/components/results/format.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { errorMessage, formatSeconds } from '#lib/sql/messages.ts';
	import type { ScriptResult, StatementResult } from '#lib/sql/run-types.ts';
	import { cn } from '#lib/utils.ts';
	import { getConsoleState, type ConsoleTab } from './console-state.svelte.ts';

	interface Props {
		/** Current route context. */
		db?: string;
		table?: string;
		dialect?: 'mysql' | 'mariadb';
	}

	let { db = '', table = '', dialect = 'mysql' }: Props = $props();

	const cs = getConsoleState();
	const PREVIEW_ROWS = 8;

	let editor = $state<ReturnType<typeof SqlEditor>>();
	let running = $state(false);
	let scroller = $state<HTMLElement>();

	onMount(() => {
		cs.restore();
		const onKey = (e: KeyboardEvent) => {
			// Ctrl/Cmd+Alt+C (by key code: Alt+C types a different character on macOS)
			if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyC') {
				e.preventDefault();
				cs.toggle();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	const enc = encodeURIComponent;
	const base = $derived(
		db ? (table ? `/db/${enc(db)}/table/${enc(table)}` : `/db/${enc(db)}`) : '/server'
	);
	const context = $derived(db ? (table ? `${db}.${table}` : db) : 'server');
	const schemaUrl = $derived(db ? `/api/sql/schema?db=${enc(db)}` : undefined);
	const sqlPageUrl = (sql: string) => `${base}/sql?sql_query=${enc(sql)}`;

	async function run(sql: string) {
		const text = sql.trim();
		if (!text || running) return;
		running = true;
		try {
			const res = await fetch('/api/sql/run', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sql: text, db, table })
			});
			if (!res.ok) throw new Error();
			const result = (await res.json()) as ScriptResult;
			cs.addRun({ sql: text, db, table, result, error: '' });
		} catch {
			cs.addRun({ sql: text, db, table, result: null, error: 'The query could not be run.' });
		} finally {
			running = false;
		}
		await tick();
		scroller?.scrollTo({ top: scroller.scrollHeight });
	}

	function load(sql: string) {
		cs.input = sql;
		cs.setTab('console');
		void tick().then(() => editor?.focus());
	}

	function loadAndRun(sql: string) {
		cs.input = sql;
		cs.setTab('console');
		void run(sql);
	}

	// ---- resizing ----------------------------------------------------------------------------
	const maxHeight = () => Math.round(window.innerHeight * 0.8);
	let dragging = false;
	function startDrag(e: PointerEvent) {
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function drag(e: PointerEvent) {
		if (dragging) cs.setHeight(window.innerHeight - e.clientY, maxHeight());
	}
	function endDrag() {
		if (!dragging) return;
		dragging = false;
		cs.save();
	}
	function resizeKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 80 : 24;
		if (e.key === 'ArrowUp') cs.setHeight(cs.height + step, maxHeight());
		else if (e.key === 'ArrowDown') cs.setHeight(cs.height - step, maxHeight());
		else return;
		e.preventDefault();
		cs.save();
	}

	const tabs: { id: ConsoleTab; label: string }[] = [
		{ id: 'console', label: 'Console' },
		{ id: 'history', label: 'History' },
		{ id: 'bookmarks', label: 'Bookmarks' }
	];

	function summary(s: StatementResult): string {
		if (!s.ok) return errorMessage(s.error.errno, s.error.message);
		const set = s.resultSets[0];
		const ms = `${formatSeconds(s.durationMs)} s`;
		if (set) {
			const total = s.pagination?.total ?? set.rows.length;
			return `${set.rows.length} row${set.rows.length === 1 ? '' : 's'}${
				total !== set.rows.length ? ` of ${total}` : ''
			} (${ms})`;
		}
		return `${s.affectedRows} row${s.affectedRows === 1 ? '' : 's'} affected (${ms})`;
	}
</script>

{#if cs.open}
	<section
		class="sticky bottom-0 z-30 flex shrink-0 flex-col border-t bg-card shadow-card"
		style="height: {cs.height}px"
		aria-label="SQL console"
		data-testid="console"
	>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize console"
			aria-valuenow={cs.height}
			aria-valuemin={160}
			tabindex="0"
			class="h-1.5 shrink-0 cursor-row-resize touch-none bg-border/50 transition-colors outline-none hover:bg-primary/40 focus-visible:bg-primary/60"
			data-testid="console-resize"
			onpointerdown={startDrag}
			onpointermove={drag}
			onpointerup={endDrag}
			onpointercancel={endDrag}
			onkeydown={resizeKey}
		></div>

		<div class="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
			<div class="flex gap-1" role="tablist" aria-label="Console sections">
				{#each tabs as t (t.id)}
					<button
						type="button"
						role="tab"
						aria-selected={cs.tab === t.id}
						class={cn(
							'rounded-lg px-3 py-1 text-sm font-medium transition-colors',
							cs.tab === t.id
								? 'bg-primary-soft text-primary'
								: 'text-muted-foreground hover:bg-muted hover:text-foreground'
						)}
						onclick={() => cs.setTab(t.id)}>{t.label}</button
					>
				{/each}
			</div>
			<span class="ms-3 truncate text-xs text-muted-foreground" data-testid="console-context"
				>Context: <span class="font-mono">{context}</span></span
			>
			<div class="ms-auto flex items-center gap-1">
				{#if cs.tab === 'console' && cs.runs.length}
					<Button type="button" variant="ghost" size="sm" onclick={() => cs.clearRuns()}
						>Clear output</Button
					>
				{/if}
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label="Close console"
					onclick={() => cs.setOpen(false)}><X class="size-4" aria-hidden="true" /></Button
				>
			</div>
		</div>

		{#if cs.tab === 'console'}
			<div class="min-h-0 flex-1 overflow-auto px-3 py-2" bind:this={scroller}>
				{#if cs.runs.length === 0}
					<p class="text-sm text-muted-foreground">
						Run a query in {context}. Press Ctrl/Cmd+Enter to execute.
					</p>
				{/if}
				{#each cs.runs as r (r.id)}
					<div class="mb-3 text-sm" data-testid="console-run">
						<pre
							class="overflow-auto rounded-lg bg-muted px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">{r.sql}</pre>
						{#if r.result === null}
							<p class="mt-1 text-destructive">{r.error}</p>
						{:else}
							{#each r.result.statements as s (s.index)}
								<p
									class={cn('mt-1 text-xs', s.ok ? 'text-muted-foreground' : 'text-destructive')}
									data-testid="console-status"
								>
									{summary(s)}
								</p>
								{#if s.ok && s.resultSets[0] && s.resultSets[0].rows.length}
									{@const set = s.resultSets[0]}
									<div class="mt-1 max-w-full overflow-auto rounded-lg border">
										<table class="w-full text-xs" data-testid="console-table">
											<thead class="bg-muted text-start">
												<tr>
													{#each set.fields as f, i (i)}
														<th class="px-2 py-1 text-start font-medium">{f.name}</th>
													{/each}
												</tr>
											</thead>
											<tbody>
												{#each set.rows.slice(0, PREVIEW_ROWS) as row, ri (ri)}
													<tr class="border-t">
														{#each row as cell, ci (ci)}
															<td
																class={cn(
																	'max-w-64 truncate px-2 py-1 font-mono',
																	cell === null && 'text-muted-foreground italic'
																)}>{cellText(cell)}</td
															>
														{/each}
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
									{#if set.rows.length > PREVIEW_ROWS}
										<p class="mt-1 text-xs text-muted-foreground">
											Showing the first {PREVIEW_ROWS} of {set.rows.length} rows.
										</p>
									{/if}
								{/if}
							{/each}
							<!-- eslint-disable svelte/no-navigation-without-resolve -- href is a route built from the current context -->
							<a
								class="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
								href={sqlPageUrl(r.sql)}
							>
								<ExternalLink class="size-3" aria-hidden="true" />Open in SQL page
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/if}
					</div>
				{/each}
			</div>
			<div class="flex shrink-0 items-end gap-2 border-t px-3 py-2">
				<SqlEditor
					bind:this={editor}
					bind:value={cs.input}
					class="min-w-0 flex-1"
					aria-label="Console query"
					{dialect}
					{schemaUrl}
					minLines={2}
					maxHeight="7rem"
					lint={false}
					placeholder="Run SQL in {context}"
					onrun={(v) => run(v)}
				/>
				<Button
					type="button"
					size="sm"
					disabled={running || cs.input.trim() === ''}
					onclick={() => run(cs.input)}
				>
					<Play class="size-4" aria-hidden="true" />Run
				</Button>
			</div>
		{:else if cs.tab === 'history'}
			<div class="min-h-0 flex-1 overflow-auto px-3 py-2">
				<QueryHistory refreshKey={cs.historyKey} onload={load} />
			</div>
		{:else}
			<div class="min-h-0 flex-1 overflow-auto px-3 py-2">
				<BookmarkList {db} onload={load} onrun={loadAndRun} />
			</div>
		{/if}
	</section>
{/if}
