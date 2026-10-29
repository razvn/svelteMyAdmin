<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import type { Component } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Table2 from '@lucide/svelte/icons/table-2';
	import Plus from '@lucide/svelte/icons/plus';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import { filterNames } from '#lib/nav/grouping.ts';
	import { cn } from '#lib/utils.ts';

	interface Props {
		/** Group title, e.g. "Tables". */
		title: string;
		icon: Component;
		items: string[];
		hrefFor: (name: string) => string;
		isActive?: (name: string) => boolean;
		/** Quick-access link next to an item (e.g. table structure). */
		quickHref?: (name: string) => string;
		quickLabel?: string;
		/** Hide an item from the tree (navigationhiding feature); no button when omitted. */
		onhide?: (name: string) => void;
		/** "New ..." entry shown first. */
		newEntry?: { label: string; href: string };
		itemFilterMinimum: number;
		maxItems: number;
		/** Keep the group open (e.g. it holds the current item). */
		forceOpen?: boolean;
	}

	let {
		title,
		icon: Icon,
		items,
		hrefFor,
		isActive = () => false,
		quickHref,
		quickLabel = 'Open',
		onhide,
		newEntry,
		itemFilterMinimum,
		maxItems,
		forceOpen = false
	}: Props = $props();

	let open = $state(true);
	let query = $state('');
	let limit = $state<number | null>(null);

	const effectiveLimit = $derived(limit ?? maxItems);
	const filtered = $derived(filterNames(items, query));
	const visible = $derived(filtered.slice(0, effectiveLimit));
	const showFilter = $derived(items.length >= itemFilterMinimum);
	const isOpen = $derived(open || forceOpen);
	const regionId = $props.id();
</script>

<Sidebar.MenuSubItem data-testid="nav-group-{title.toLowerCase()}">
	<button
		type="button"
		class="flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground outline-hidden hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
		aria-expanded={isOpen}
		aria-controls={regionId}
		onclick={() => (open = !isOpen)}
	>
		<ChevronRight class={cn('size-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')} />
		<Icon class="size-3.5 shrink-0" />
		<span class="truncate">{title}</span>
		<span
			class="ms-auto rounded-full bg-muted px-1.5 text-[11px] leading-5 font-medium text-muted-foreground tabular-nums"
			data-testid="count">{items.length}</span
		>
	</button>

	{#if isOpen}
		<div id={regionId}>
			<Sidebar.MenuSub class="mx-2 ms-3.5 mt-0.5">
				{#if showFilter}
					<Sidebar.MenuSubItem>
						<Sidebar.Input
							placeholder="Filter {title.toLowerCase()}"
							aria-label="Filter {title.toLowerCase()}"
							class="h-7 text-xs"
							bind:value={query}
						/>
					</Sidebar.MenuSubItem>
				{/if}

				{#if newEntry}
					<Sidebar.MenuSubItem>
						<Sidebar.MenuSubButton size="sm">
							{#snippet child({ props })}
								<a {...props} href={resolve(bare(newEntry.href))}>
									<Plus />
									<span>{newEntry.label}</span>
								</a>
							{/snippet}
						</Sidebar.MenuSubButton>
					</Sidebar.MenuSubItem>
				{/if}

				{#each visible as name (name)}
					<Sidebar.MenuSubItem class="group/item relative">
						<Sidebar.MenuSubButton size="sm" isActive={isActive(name)}>
							{#snippet child({ props })}
								<a
									{...props}
									href={resolve(bare(hrefFor(name)))}
									title={name}
									aria-current={isActive(name) ? 'page' : undefined}
								>
									<Icon />
									<span>{name}</span>
								</a>
							{/snippet}
						</Sidebar.MenuSubButton>
						{#if quickHref}
							<a
								href={resolve(bare(quickHref(name)))}
								aria-label={quickLabel}
								title={quickLabel}
								class={cn(
									'absolute top-1/2 hidden size-5 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/70 outline-hidden group-focus-within/item:flex group-hover/item:flex hover:bg-sidebar-border focus-visible:ring-2 focus-visible:ring-sidebar-ring',
									onhide ? 'end-7' : 'end-1'
								)}
							>
								<Table2 class="size-3.5" />
							</a>
						{/if}
						{#if onhide}
							<button
								type="button"
								aria-label="Hide {name}"
								title="Hide"
								data-testid="hide-{name}"
								onclick={() => onhide(name)}
								class="absolute end-1 top-1/2 hidden size-5 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/70 outline-hidden group-focus-within/item:flex group-hover/item:flex hover:bg-sidebar-border focus-visible:ring-2 focus-visible:ring-sidebar-ring"
							>
								<EyeOff class="size-3.5" />
							</button>
						{/if}
					</Sidebar.MenuSubItem>
				{/each}

				{#if filtered.length === 0 && query !== ''}
					<Sidebar.MenuSubItem>
						<span class="px-2 text-xs text-muted-foreground">No match</span>
					</Sidebar.MenuSubItem>
				{/if}

				{#if filtered.length > visible.length}
					<Sidebar.MenuSubItem>
						<button
							type="button"
							class="h-7 w-full rounded-md px-2 text-start text-xs text-muted-foreground outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-sidebar-ring"
							onclick={() => (limit = effectiveLimit + maxItems)}
						>
							Show more ({filtered.length - visible.length} left)
						</button>
					</Sidebar.MenuSubItem>
				{/if}
			</Sidebar.MenuSub>
		</div>
	{/if}
</Sidebar.MenuSubItem>
