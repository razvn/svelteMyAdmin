<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import { untrack } from 'svelte';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Database from '@lucide/svelte/icons/database';
	import Eye from '@lucide/svelte/icons/eye';
	import FunctionSquare from '@lucide/svelte/icons/square-function';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Table2 from '@lucide/svelte/icons/table-2';
	import Terminal from '@lucide/svelte/icons/square-terminal';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import { dbHref, tableHref, type NavConfig } from '#lib/nav/config.ts';
	import { tabHref } from '#lib/nav/tabs.ts';
	import { cn } from '#lib/utils.ts';
	import ItemGroup from './item-group.svelte';
	import type { NavState } from './nav-state.svelte.ts';

	interface Props {
		/** Full database name. */
		name: string;
		/** Text to show (inside a group the shared prefix is dropped). */
		label?: string;
		nav: NavConfig;
		navState: NavState;
		currentDb?: string;
		currentTable?: string;
	}

	let { name, label = name, nav, navState, currentDb, currentTable }: Props = $props();

	const expanded = $derived(navState.isExpanded(name));
	const status = $derived(navState.status[name]);
	const children = $derived(navState.children[name]);
	const isCurrent = $derived(currentDb === name);

	// Follow the route: the current database is expanded (and loaded) automatically.
	$effect(() => {
		if (nav.expansionEnabled && isCurrent) untrack(() => void navState.expand(name));
	});

	const routineHref = (type: 'PROCEDURE' | 'FUNCTION') => (item: string) =>
		`${tabHref('db', { db: name }, 'routines')}?type=${type}&item=${encodeURIComponent(item)}`;
	const eventHref = (item: string) =>
		`${tabHref('db', { db: name }, 'events')}?item=${encodeURIComponent(item)}`;
	const isCurrentTable = (t: string) => isCurrent && currentTable === t;
</script>

<Sidebar.MenuItem data-testid="nav-db-{name}">
	<div class="flex items-center gap-0.5">
		{#if nav.expansionEnabled}
			<button
				type="button"
				class="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-sidebar-ring"
				aria-expanded={expanded}
				aria-label="{expanded ? 'Collapse' : 'Expand'} {name}"
				onclick={() => void navState.toggle(name)}
			>
				{#if status === 'loading' && expanded}
					<LoaderCircle class="size-4 animate-spin" />
				{:else}
					<ChevronRight class={cn('size-4 transition-transform', expanded && 'rotate-90')} />
				{/if}
			</button>
		{/if}
		<Sidebar.MenuButton isActive={isCurrent && !currentTable} class="min-w-0 flex-1">
			{#snippet child({ props })}
				<a
					{...props}
					href={resolve(bare(dbHref(nav, name)))}
					title={name}
					aria-current={isCurrent && !currentTable ? 'page' : undefined}
				>
					<Database />
					<span>{label}</span>
				</a>
			{/snippet}
		</Sidebar.MenuButton>
	</div>

	{#if expanded}
		<Sidebar.MenuSub>
			{#if status === 'error'}
				<Sidebar.MenuSubItem>
					<button
						type="button"
						class="w-full px-2 text-start text-xs text-destructive"
						onclick={() => void navState.load(name, true)}
					>
						Could not load. Retry
					</button>
				</Sidebar.MenuSubItem>
			{:else if !children}
				<Sidebar.MenuSubItem>
					<span class="px-2 text-xs text-muted-foreground" role="status">Loading...</span>
				</Sidebar.MenuSubItem>
			{:else}
				{#if nav.showTables}
					<ItemGroup
						title="Tables"
						icon={Table2}
						items={children.tables}
						hrefFor={(t) => tableHref(nav, name, t)}
						isActive={isCurrentTable}
						quickHref={(t) => tabHref('table', { db: name, table: t }, nav.quickTabTable)}
						quickLabel="Open {nav.quickTabTable}"
						newEntry={{ label: 'New table', href: tabHref('db', { db: name }, 'create-table') }}
						itemFilterMinimum={nav.itemFilterMinimum}
						maxItems={nav.maxItems}
						forceOpen={isCurrent && !!currentTable && children.tables.includes(currentTable)}
					/>
				{/if}
				{#if nav.showViews}
					<ItemGroup
						title="Views"
						icon={Eye}
						items={children.views}
						hrefFor={(t) => tableHref(nav, name, t)}
						isActive={isCurrentTable}
						quickHref={(t) => tabHref('table', { db: name, table: t }, nav.quickTabTable)}
						quickLabel="Open {nav.quickTabTable}"
						itemFilterMinimum={nav.itemFilterMinimum}
						maxItems={nav.maxItems}
						forceOpen={isCurrent && !!currentTable && children.views.includes(currentTable)}
					/>
				{/if}
				{#if nav.showProcedures}
					<ItemGroup
						title="Procedures"
						icon={Terminal}
						items={children.procedures}
						hrefFor={routineHref('PROCEDURE')}
						itemFilterMinimum={nav.itemFilterMinimum}
						maxItems={nav.maxItems}
					/>
				{/if}
				{#if nav.showFunctions}
					<ItemGroup
						title="Functions"
						icon={FunctionSquare}
						items={children.functions}
						hrefFor={routineHref('FUNCTION')}
						itemFilterMinimum={nav.itemFilterMinimum}
						maxItems={nav.maxItems}
					/>
				{/if}
				{#if nav.showEvents}
					<ItemGroup
						title="Events"
						icon={CalendarClock}
						items={children.events}
						hrefFor={eventHref}
						itemFilterMinimum={nav.itemFilterMinimum}
						maxItems={nav.maxItems}
					/>
				{/if}
			{/if}
		</Sidebar.MenuSub>
	{/if}
</Sidebar.MenuItem>
