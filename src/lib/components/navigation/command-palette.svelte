<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import { goto } from '$app/navigation';
	import Database from '@lucide/svelte/icons/database';
	import Eye from '@lucide/svelte/icons/eye';
	import LayoutList from '@lucide/svelte/icons/layout-list';
	import Table2 from '@lucide/svelte/icons/table-2';
	import * as Command from '#lib/components/ui/command/index.ts';
	import { dbHref, tableHref, type NavConfig } from '#lib/nav/config.ts';
	import { rankItems, type PaletteItem, type PaletteKind } from '#lib/nav/palette.ts';
	import { dbTabs, serverTabs, tabHref, tableTabs } from '#lib/nav/tabs.ts';
	import type { NavState } from './nav-state.svelte.ts';

	interface Props {
		open: boolean;
		databases: string[];
		nav: NavConfig;
		navState: NavState;
		currentDb?: string;
		currentTable?: string;
		currentTableType?: 'table' | 'view';
	}

	let {
		open = $bindable(false),
		databases,
		nav,
		navState,
		currentDb,
		currentTable,
		currentTableType = 'table'
	}: Props = $props();

	let query = $state('');

	const items = $derived.by((): PaletteItem[] => {
		const out: PaletteItem[] = [];
		// Tabs of the current context first (most likely target), then the rest.
		if (currentDb && currentTable) {
			for (const tab of tableTabs({ isView: currentTableType === 'view' })) {
				out.push({
					id: `tab:table:${tab.id}`,
					kind: 'tab',
					label: tab.label,
					description: `Table ${currentTable}`,
					href: tabHref('table', { db: currentDb, table: currentTable }, tab.path)
				});
			}
		}
		if (currentDb) {
			for (const tab of dbTabs()) {
				out.push({
					id: `tab:db:${tab.id}`,
					kind: 'tab',
					label: tab.label,
					description: `Database ${currentDb}`,
					href: tabHref('db', { db: currentDb }, tab.path)
				});
			}
		}
		for (const tab of serverTabs({ binlog: true })) {
			out.push({
				id: `tab:server:${tab.id}`,
				kind: 'tab',
				label: tab.label,
				description: 'Server',
				href: tabHref('server', {}, tab.path)
			});
		}
		for (const db of databases) {
			out.push({
				id: `db:${db}`,
				kind: 'database',
				label: db,
				description: 'Database',
				href: dbHref(nav, db)
			});
		}
		for (const [db, children] of Object.entries(navState.children)) {
			for (const t of children.tables) {
				out.push({
					id: `table:${db}.${t}`,
					kind: 'table',
					label: t,
					description: `Table in ${db}`,
					href: tableHref(nav, db, t)
				});
			}
			for (const v of children.views) {
				out.push({
					id: `view:${db}.${v}`,
					kind: 'view',
					label: v,
					description: `View in ${db}`,
					href: tableHref(nav, db, v)
				});
			}
		}
		return out;
	});

	const results = $derived(rankItems(items, query, 40));

	const ICONS: Record<PaletteKind, typeof Database> = {
		database: Database,
		table: Table2,
		view: Eye,
		tab: LayoutList,
		page: LayoutList
	};

	function choose(href: string) {
		open = false;
		query = '';
		void goto(resolve(bare(href)));
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey) {
			event.preventDefault();
			open = !open;
		}
	}
</script>

<svelte:window {onkeydown} />

<Command.Dialog
	bind:open
	shouldFilter={false}
	title="Command palette"
	description="Jump to a database, table or page"
>
	<Command.Input placeholder="Jump to a database, table or page..." bind:value={query} />
	<Command.List>
		<Command.Empty>No results found.</Command.Empty>
		{#each results as item (item.id)}
			{@const Icon = ICONS[item.kind]}
			<Command.Item value={item.id} onSelect={() => choose(item.href)}>
				<Icon />
				<span>{item.label}</span>
				{#if item.description}
					<span class="ms-auto text-xs text-muted-foreground">{item.description}</span>
				{/if}
			</Command.Item>
		{/each}
	</Command.List>
</Command.Dialog>
