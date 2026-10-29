<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import type { HiddenItem } from '#lib/nav/hidden.ts';
	import type { NavState } from './nav-state.svelte.ts';

	interface Props {
		open: boolean;
		db: string;
		navState: NavState;
	}

	let { open = $bindable(false), db, navState }: Props = $props();

	const TITLES: Record<HiddenItem['type'], string> = {
		table: 'Tables',
		view: 'Views',
		procedure: 'Procedures',
		function: 'Functions',
		event: 'Events'
	};

	let items = $state<HiddenItem[]>([]);
	let loading = $state(false);

	async function load() {
		loading = true;
		try {
			const res = await fetch(`/api/navigation/hidden?db=${encodeURIComponent(db)}`);
			items = res.ok ? ((await res.json()).items as HiddenItem[]) : [];
		} catch {
			items = [];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open) void load();
	});

	async function unhide(item: HiddenItem) {
		if (await navState.setHidden(db, item.name, item.type, false)) {
			items = items.filter((i) => !(i.name === item.name && i.type === item.type));
			if (items.length === 0) open = false;
		}
	}

	const grouped = $derived(
		(Object.keys(TITLES) as HiddenItem['type'][])
			.map((type) => ({ type, rows: items.filter((i) => i.type === type) }))
			.filter((g) => g.rows.length > 0)
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Content data-testid="hidden-items-dialog">
		<Dialog.Header>
			<Dialog.Title>Hidden items in {db}</Dialog.Title>
			<Dialog.Description
				>Unhide an item to show it in the navigation tree again.</Dialog.Description
			>
		</Dialog.Header>
		{#if loading && items.length === 0}
			<p class="text-sm text-muted-foreground" role="status">Loading...</p>
		{:else if grouped.length === 0}
			<p class="text-sm text-muted-foreground">There are no hidden items.</p>
		{/if}
		<div class="grid max-h-80 gap-3 overflow-y-auto">
			{#each grouped as g (g.type)}
				<section class="grid gap-1">
					<h3 class="text-xs font-semibold text-muted-foreground uppercase">{TITLES[g.type]}</h3>
					{#each g.rows as item (item.name)}
						<div class="flex items-center justify-between gap-2 text-sm">
							<span class="truncate font-mono">{item.name}</span>
							<Button
								variant="outline"
								size="sm"
								aria-label="Unhide {item.name}"
								onclick={() => void unhide(item)}>Unhide</Button
							>
						</div>
					{/each}
				</section>
			{/each}
		</div>
	</Dialog.Content>
</Dialog.Root>
