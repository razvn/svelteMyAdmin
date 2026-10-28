<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import Play from '@lucide/svelte/icons/play';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { countVariables } from '#lib/sql/bookmark.ts';

	interface Bookmark {
		id: number;
		db: string;
		label: string;
		query: string;
		shared: boolean;
	}

	interface Props {
		/** Database whose bookmarks are listed ('' = server level). */
		db: string;
		/** Put the (variable-substituted) query into the editor. */
		onload: (sql: string, bookmark: Bookmark) => void;
		/** Run the (variable-substituted) query. */
		onrun: (sql: string, bookmark: Bookmark) => void;
		refreshKey?: number;
		class?: string;
	}

	let { db, onload, onrun, refreshKey = 0, class: className }: Props = $props();

	let bookmarks = $state.raw<Bookmark[]>([]);
	let available = $state(true);
	let loaded = $state(false);
	let pending = $state<{ id: number; mode: 'load' | 'run' } | null>(null);
	let values = $state<string[]>([]);

	$effect(() => {
		void refreshKey;
		const controller = new AbortController();
		fetch(`/api/sql/bookmarks?db=${encodeURIComponent(db)}`, { signal: controller.signal })
			.then(async (res) => {
				if (!res.ok) throw new Error();
				const body = (await res.json()) as { available: boolean; bookmarks: Bookmark[] };
				available = body.available;
				bookmarks = body.bookmarks;
				loaded = true;
			})
			.catch((e) => {
				if (e instanceof DOMException && e.name === 'AbortError') return;
				available = false;
				loaded = true;
			});
		return () => controller.abort();
	});

	async function apply(b: Bookmark, mode: 'load' | 'run', variables: string[]) {
		const res = await fetch('/api/sql/bookmarks', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'apply', db, id: b.id, variables })
		});
		if (!res.ok) {
			toast.error('The bookmark could not be loaded.');
			return;
		}
		const { sql } = (await res.json()) as { sql: string };
		pending = null;
		if (mode === 'load') onload(sql, b);
		else onrun(sql, b);
	}

	function start(b: Bookmark, mode: 'load' | 'run') {
		const n = countVariables(b.query);
		if (n === 0) {
			void apply(b, mode, []);
			return;
		}
		values = Array.from({ length: n }, () => '');
		pending = { id: b.id, mode };
	}

	async function remove(b: Bookmark) {
		const res = await fetch(`/api/sql/bookmarks?id=${b.id}`, { method: 'DELETE' });
		if (!res.ok) {
			toast.error('The bookmark could not be deleted.');
			return;
		}
		bookmarks = bookmarks.filter((x) => x.id !== b.id);
		toast.success(`Bookmark ${b.label} deleted`);
	}
</script>

<div class={className} data-testid="bookmark-list">
	{#if loaded && !available}
		<p class="text-sm text-muted-foreground">
			Bookmarks need the configuration storage (the <code>bookmarktable</code> setting).
		</p>
	{:else if loaded && bookmarks.length === 0}
		<p class="text-sm text-muted-foreground" data-testid="bookmarks-empty">No bookmarks yet.</p>
	{:else}
		<ul class="flex max-h-64 flex-col gap-1 overflow-auto">
			{#each bookmarks as b (b.id)}
				<li class="rounded-lg border px-2.5 py-1.5" data-testid="bookmark-item">
					<div class="flex items-center gap-2">
						<span class="min-w-0 flex-1 truncate text-sm font-medium" title={b.query}
							>{b.label}</span
						>
						{#if b.shared}<Badge variant="info">Shared</Badge>{/if}
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Edit bookmark {b.label}"
							title="Load into the editor"
							onclick={() => start(b, 'load')}><Pencil class="size-4" aria-hidden="true" /></Button
						>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Run bookmark {b.label}"
							title="Run"
							onclick={() => start(b, 'run')}><Play class="size-4" aria-hidden="true" /></Button
						>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							class="text-destructive hover:text-destructive"
							aria-label="Delete bookmark {b.label}"
							title="Delete"
							onclick={() => remove(b)}><Trash2 class="size-4" aria-hidden="true" /></Button
						>
					</div>
					{#if pending?.id === b.id}
						<form
							class="mt-2 flex flex-col gap-2 border-t pt-2"
							data-testid="bookmark-variables"
							onsubmit={(e) => {
								e.preventDefault();
								if (pending) void apply(b, pending.mode, values);
							}}
						>
							{#each values.keys() as i (i)}
								<div class="flex items-center gap-2">
									<Label class="w-24 shrink-0 font-mono text-xs" for="bm-{b.id}-var-{i}"
										>VARIABLE{i + 1}</Label
									>
									<Input id="bm-{b.id}-var-{i}" class="h-8" bind:value={values[i]} />
								</div>
							{/each}
							<div class="flex justify-end gap-2">
								<Button type="button" variant="ghost" size="sm" onclick={() => (pending = null)}
									>Cancel</Button
								>
								<Button type="submit" size="sm">{pending.mode === 'run' ? 'Run' : 'Load'}</Button>
							</div>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
