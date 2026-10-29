<script lang="ts">
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import { filterHistory, type HistoryEntry } from '#lib/sql/history.ts';

	interface Props {
		/** Put a query into the editor. */
		onload: (sql: string) => void;
		/** Bump to refetch (after running a query). */
		refreshKey?: number;
		class?: string;
	}

	let { onload, refreshKey = 0, class: className }: Props = $props();

	const { t } = useI18n();
	let entries = $state.raw<HistoryEntry[]>([]);
	let loaded = $state(false);
	let failed = $state(false);
	let term = $state('');

	const shown = $derived(filterHistory(entries, term));

	$effect(() => {
		void refreshKey;
		const controller = new AbortController();
		fetch('/api/sql/history', { signal: controller.signal })
			.then(async (res) => {
				if (!res.ok) throw new Error();
				const body = (await res.json()) as { entries: HistoryEntry[] };
				entries = body.entries;
				failed = false;
				loaded = true;
			})
			.catch((e) => {
				if (e instanceof DOMException && e.name === 'AbortError') return;
				failed = true;
				loaded = true;
			});
		return () => controller.abort();
	});

	async function clear() {
		const res = await fetch('/api/sql/history', { method: 'DELETE' });
		if (res.ok) entries = [];
	}
</script>

<div class={className} data-testid="query-history">
	<div class="flex items-center gap-2 pb-2">
		<Input
			type="search"
			class="h-8"
			placeholder={t('Search history')}
			aria-label={t('Search history')}
			bind:value={term}
		/>
		<Button
			type="button"
			variant="ghost"
			size="sm"
			disabled={entries.length === 0}
			onclick={clear}
			aria-label={t('Clear history')}
		>
			<Trash2 class="size-4" aria-hidden="true" />{t('Clear')}
		</Button>
	</div>
	{#if failed}
		<p class="text-sm text-destructive">{t('The history could not be loaded.')}</p>
	{:else if loaded && shown.length === 0}
		<p class="text-sm text-muted-foreground" data-testid="history-empty">
			{entries.length ? t('No matching queries.') : t('No queries have been run yet.')}
		</p>
	{:else}
		<ul class="flex max-h-64 flex-col gap-1 overflow-auto">
			{#each shown as e, i (i)}
				<li>
					<button
						type="button"
						class="block w-full rounded-lg border border-transparent px-2.5 py-1.5 text-start hover:border-border hover:bg-muted"
						title={t('Load this query')}
						aria-label={t('Load query {n} into the editor', { n: i + 1 })}
						data-testid="history-item"
						onclick={() => onload(e.sqlquery)}
					>
						<span class="line-clamp-2 font-mono text-xs break-all whitespace-pre-wrap"
							>{e.sqlquery}</span
						>
						<span class="text-[11px] text-muted-foreground">
							{#if e.db}{e.db}{e.table ? `.${e.table}` : ''} -{/if}
							{e.timevalue}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
