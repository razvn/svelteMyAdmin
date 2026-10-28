<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { refreshAll } from '$app/navigation';
	import Breadcrumbs from '#lib/components/app-shell/breadcrumbs.svelte';
	import ConsoleDrawer from '#lib/components/console/console-drawer.svelte';
	import { ConsoleState, setConsoleState } from '#lib/components/console/console-state.svelte.ts';
	import TopBar from '#lib/components/app-shell/top-bar.svelte';
	import AppSidebar from '#lib/components/navigation/app-sidebar.svelte';
	import CommandPalette from '#lib/components/navigation/command-palette.svelte';
	import { NavState, setNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import { SidebarWidth } from '#lib/components/navigation/sidebar-width.svelte.ts';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const navState = new NavState();
	setNavState(navState);
	// The configured width is only the initial value; the user's choice is restored on mount.
	// svelte-ignore state_referenced_locally
	const width = new SidebarWidth(data.nav.width);
	onMount(() => width.restore());

	const consoleState = new ConsoleState();
	setConsoleState(consoleState);

	let paletteOpen = $state(false);

	const db = $derived(page.params.db);
	const table = $derived(page.params.table);
	const tableType = $derived(page.data.tableType as 'table' | 'view' | undefined);

	async function reload() {
		await refreshAll();
		await navState.reload();
	}
</script>

<Sidebar.Provider style="--sidebar-width: {width.value}px">
	<AppSidebar
		databases={data.databases}
		nav={data.nav}
		{navState}
		{width}
		currentDb={db}
		currentTable={table}
		onreload={reload}
	/>
	<Sidebar.Inset class="min-w-0 bg-background">
		<TopBar
			session={data.session}
			servers={data.servers}
			onsearch={() => (paletteOpen = true)}
			onconsole={() => consoleState.toggle()}
			consoleOpen={consoleState.open}
		/>
		<div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<Breadcrumbs nav={data.nav} serverLabel={data.session.serverLabel} {db} {table} {tableType} />
			{@render children()}
		</div>
		<ConsoleDrawer {db} {table} dialect={data.dialect} />
	</Sidebar.Inset>
</Sidebar.Provider>

<CommandPalette
	bind:open={paletteOpen}
	databases={data.databases}
	nav={data.nav}
	{navState}
	currentDb={db}
	currentTable={table}
	currentTableType={tableType}
/>
