<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Clock from '@lucide/svelte/icons/clock';
	import Star from '@lucide/svelte/icons/star';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import { tableHref, type NavConfig } from '#lib/nav/config.ts';
	import type { TableRef } from '#lib/nav/recent.ts';
	import { cn } from '#lib/utils.ts';
	import type { QuickAccess } from './quick-access.svelte.ts';

	interface Props {
		quick: QuickAccess;
		nav: NavConfig;
		/** Changes whenever the user moves to another table: reload the lists. */
		scope: string;
	}

	let { quick, nav, scope }: Props = $props();

	// The visit is recorded while the page loads: ask for the lists once the route has settled.
	$effect(() => {
		void scope;
		void quick.refresh();
	});

	const sections = $derived([
		{ id: 'recent', title: 'Recent', icon: Clock, items: quick.recent, empty: 'No recent tables' },
		{
			id: 'favorites',
			title: 'Favorites',
			icon: Star,
			items: quick.favorites,
			empty: 'No favorite tables'
		}
	]);
	let open = $state<Record<string, boolean>>({});
	const label = (t: TableRef) => `${t.db}.${t.table}`;
</script>

<Sidebar.Group class="gap-1 px-3 py-1">
	<Sidebar.GroupContent>
		<Sidebar.Menu aria-label="Recent and favorite tables">
			{#each sections as s (s.id)}
				{@const isOpen = open[s.id] === true}
				{@const regionId = `quick-${s.id}`}
				<Sidebar.MenuItem data-testid="nav-{s.id}">
					<button
						type="button"
						class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm outline-hidden hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
						aria-expanded={isOpen}
						aria-controls={regionId}
						onclick={() => (open[s.id] = !isOpen)}
					>
						<ChevronRight
							class={cn(
								'size-4 shrink-0 text-sidebar-foreground/70 transition-transform',
								isOpen && 'rotate-90'
							)}
						/>
						<s.icon class="size-4 shrink-0" />
						<span class="truncate">{s.title}</span>
						<span
							class="ms-auto rounded-full bg-muted px-1.5 text-[11px] leading-5 font-medium text-muted-foreground tabular-nums"
							data-testid="count">{s.items.length}</span
						>
					</button>
					{#if isOpen}
						<Sidebar.MenuSub id={regionId}>
							{#each s.items as t (label(t))}
								<Sidebar.MenuSubItem>
									<Sidebar.MenuSubButton size="sm">
										{#snippet child({ props })}
											<a
												{...props}
												href={resolve(bare(tableHref(nav, t.db, t.table)))}
												title={label(t)}
											>
												<span>{label(t)}</span>
											</a>
										{/snippet}
									</Sidebar.MenuSubButton>
								</Sidebar.MenuSubItem>
							{:else}
								<Sidebar.MenuSubItem>
									<span class="px-2 text-xs text-muted-foreground">{s.empty}</span>
								</Sidebar.MenuSubItem>
							{/each}
						</Sidebar.MenuSub>
					{/if}
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>
