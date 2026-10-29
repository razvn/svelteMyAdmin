<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import { untrack } from 'svelte';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Database from '@lucide/svelte/icons/database';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import FunctionSquare from '@lucide/svelte/icons/square-function';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Table2 from '@lucide/svelte/icons/table-2';
	import Terminal from '@lucide/svelte/icons/square-terminal';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import { dbHref, tableHref, type NavConfig } from '#lib/nav/config.ts';
	import type { HiddenType } from '#lib/nav/hidden.ts';
	import { tabHref } from '#lib/nav/tabs.ts';
	import { N_ } from '#lib/i18n/index.ts';
	import { cn } from '#lib/utils.ts';
	import HiddenItemsDialog from './hidden-items-dialog.svelte';
	import ItemGroup from './item-group.svelte';
	import type { NavState } from './nav-state.svelte.ts';

	const { t } = useI18n();

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
	let hiddenOpen = $state(false);
	const hide = (type: HiddenType) =>
		children?.canHide
			? (item: string) => void navState.setHidden(name, item, type, true)
			: undefined;
	const isCurrentTable = (tbl: string) => isCurrent && currentTable === tbl;
</script>

<Sidebar.MenuItem data-testid="nav-db-{name}">
	<div class="flex items-center gap-0.5">
		{#if nav.expansionEnabled}
			<button
				type="button"
				class="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-sidebar-ring"
				aria-expanded={expanded}
				aria-label={expanded ? t('Collapse {name}', { name }) : t('Expand {name}', { name })}
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
						{t('Could not load. Retry')}
					</button>
				</Sidebar.MenuSubItem>
			{:else if !children}
				<Sidebar.MenuSubItem>
					<span class="px-2 text-xs text-muted-foreground" role="status">{t('Loading...')}</span>
				</Sidebar.MenuSubItem>
			{:else}
				{#if nav.showTables}
					<ItemGroup
						title={N_('Tables')}
						icon={Table2}
						items={children.tables}
						hrefFor={(tbl) => tableHref(nav, name, tbl)}
						isActive={isCurrentTable}
						quickHref={(tbl) => tabHref('table', { db: name, table: tbl }, nav.quickTabTable)}
						quickLabel={t('Open {tab}', { tab: nav.quickTabTable })}
						onhide={hide('table')}
						newEntry={{ label: N_('New table'), href: tabHref('db', { db: name }, 'create-table') }}
						itemFilterMinimum={nav.itemFilterMinimum}
						maxItems={nav.maxItems}
						forceOpen={isCurrent && !!currentTable && children.tables.includes(currentTable)}
					/>
				{/if}
				{#if nav.showViews}
					<ItemGroup
						title={N_('Views')}
						icon={Eye}
						items={children.views}
						onhide={hide('view')}
						hrefFor={(tbl) => tableHref(nav, name, tbl)}
						isActive={isCurrentTable}
						quickHref={(tbl) => tabHref('table', { db: name, table: tbl }, nav.quickTabTable)}
						quickLabel={t('Open {tab}', { tab: nav.quickTabTable })}
						itemFilterMinimum={nav.itemFilterMinimum}
						maxItems={nav.maxItems}
						forceOpen={isCurrent && !!currentTable && children.views.includes(currentTable)}
					/>
				{/if}
				{#if nav.showProcedures}
					<ItemGroup
						title={N_('Procedures')}
						icon={Terminal}
						items={children.procedures}
						onhide={hide('procedure')}
						hrefFor={routineHref('PROCEDURE')}
						itemFilterMinimum={nav.itemFilterMinimum}
						maxItems={nav.maxItems}
					/>
				{/if}
				{#if nav.showFunctions}
					<ItemGroup
						title={N_('Functions')}
						icon={FunctionSquare}
						items={children.functions}
						onhide={hide('function')}
						hrefFor={routineHref('FUNCTION')}
						itemFilterMinimum={nav.itemFilterMinimum}
						maxItems={nav.maxItems}
					/>
				{/if}
				{#if nav.showEvents}
					<ItemGroup
						title={N_('Events')}
						icon={CalendarClock}
						items={children.events}
						onhide={hide('event')}
						hrefFor={eventHref}
						itemFilterMinimum={nav.itemFilterMinimum}
						maxItems={nav.maxItems}
					/>
				{/if}
				{#if children.canHide && (children.hiddenCount ?? 0) > 0}
					<Sidebar.MenuSubItem>
						<button
							type="button"
							class="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-start text-xs text-muted-foreground outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-sidebar-ring"
							data-testid="show-hidden-{name}"
							onclick={() => (hiddenOpen = true)}
						>
							<EyeOff class="size-3.5" />
							{t('Show hidden items ({count})', { count: children.hiddenCount ?? 0 })}
						</button>
					</Sidebar.MenuSubItem>
				{/if}
			{/if}
		</Sidebar.MenuSub>
	{/if}
</Sidebar.MenuItem>

<HiddenItemsDialog bind:open={hiddenOpen} db={name} {navState} />
