<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import Cog from '@lucide/svelte/icons/cog';
	import House from '@lucide/svelte/icons/house';
	import LogOut from '@lucide/svelte/icons/log-out';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import SquareTerminal from '@lucide/svelte/icons/square-terminal';
	import favicon from '#lib/assets/favicon.svg';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import type { NavConfig } from '#lib/nav/config.ts';
	import { cn } from '#lib/utils.ts';
	import NavigationTree from './navigation-tree.svelte';
	import type { NavState } from './nav-state.svelte.ts';
	import SidebarResizer from './sidebar-resizer.svelte';
	import type { SidebarWidth } from './sidebar-width.svelte.ts';

	interface Props {
		databases: string[];
		nav: NavConfig;
		navState: NavState;
		width: SidebarWidth;
		currentDb?: string;
		currentTable?: string;
		canLogout: boolean;
		onreload: () => void;
	}

	let { databases, nav, navState, width, currentDb, currentTable, canLogout, onreload }: Props =
		$props();

	const sqlHref = $derived(currentDb ? `/db/${encodeURIComponent(currentDb)}/sql` : '/server/sql');
	const quick = cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }));
</script>

<Sidebar.Root>
	<Sidebar.Header class="gap-2 border-b">
		<a
			href={resolve(bare('/'))}
			class="flex items-center gap-2 rounded-md px-1 py-0.5 outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
			aria-label="svelteMyAdmin home"
		>
			{#if nav.displayLogo}
				<img src={favicon} alt="" class="size-6" />
			{/if}
			<span class="text-base font-semibold tracking-tight">svelteMyAdmin</span>
		</a>
		<div class="flex items-center gap-0.5" role="toolbar" aria-label="Quick links">
			<a href={resolve(bare('/'))} class={quick} aria-label="Home" title="Home"><House /></a>
			<a href={resolve(bare(sqlHref))} class={quick} aria-label="SQL query" title="SQL query"
				><SquareTerminal /></a
			>
			<a
				href={resolve(bare('/server/settings'))}
				class={quick}
				aria-label="Settings"
				title="Settings"><Cog /></a
			>
			<button
				type="button"
				class={quick}
				aria-label="Reload navigation"
				title="Reload navigation"
				onclick={onreload}
			>
				<RefreshCw />
			</button>
			{#if canLogout}
				<form method="POST" action="/logout" class="contents">
					<button type="submit" class={quick} aria-label="Sign out" title="Sign out">
						<LogOut />
					</button>
				</form>
			{/if}
		</div>
	</Sidebar.Header>

	<Sidebar.Content>
		<NavigationTree {databases} {nav} {navState} {currentDb} {currentTable} />
	</Sidebar.Content>

	<SidebarResizer {width} />
</Sidebar.Root>
