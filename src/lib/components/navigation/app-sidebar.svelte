<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { bare } from '#lib/nav/paths.ts';
	import Cog from '@lucide/svelte/icons/cog';
	import House from '@lucide/svelte/icons/house';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import SquareTerminal from '@lucide/svelte/icons/square-terminal';
	import BrandMark from '#lib/components/app-shell/brand-mark.svelte';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import type { NavConfig } from '#lib/nav/config.ts';
	import NavigationTree from './navigation-tree.svelte';
	import QuickTables from './quick-tables.svelte';
	import type { QuickAccess } from './quick-access.svelte.ts';
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
		quick: QuickAccess;
		onreload: () => void;
	}

	let { databases, nav, navState, width, currentDb, currentTable, quick, onreload }: Props =
		$props();

	const sqlHref = $derived(currentDb ? `/db/${encodeURIComponent(currentDb)}/sql` : '/server/sql');
	const pathname = $derived(page.url.pathname);

	const links = $derived([
		{ label: 'Home', href: '/', icon: House, match: (p: string) => p === '/' },
		{
			label: 'SQL query',
			href: sqlHref,
			icon: SquareTerminal,
			match: (p: string) => p.endsWith('/sql')
		},
		{
			label: 'Settings',
			href: '/server/settings',
			icon: Cog,
			match: (p: string) => p.startsWith('/server/settings')
		}
	]);
</script>

<Sidebar.Root>
	<Sidebar.Header class="h-20 justify-center border-b px-6 pt-4 pb-0">
		<a
			href={resolve(bare('/'))}
			class="flex h-16 items-center gap-3 rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
			aria-label="svelteMyAdmin home"
		>
			{#if nav.displayLogo}
				<BrandMark />
			{/if}
			<span class="text-lg font-semibold tracking-tight">svelteMyAdmin</span>
		</a>
	</Sidebar.Header>

	<Sidebar.Content class="gap-2 py-3">
		<Sidebar.Group class="gap-1 px-3 py-1">
			<Sidebar.GroupLabel class="px-3">Server</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu aria-label="Quick links">
					{#each links as link (link.label)}
						{@const active = link.match(pathname)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={active}>
								{#snippet child({ props })}
									<a
										{...props}
										href={resolve(bare(link.href))}
										aria-current={active ? 'page' : undefined}
									>
										<link.icon />
										<span>{link.label}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton onclick={onreload}>
							<RefreshCw />
							<span>Reload navigation</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>

		<QuickTables {quick} {nav} scope="{currentDb ?? ''}.{currentTable ?? ''}" />

		<NavigationTree {databases} {nav} {navState} {currentDb} {currentTable} />
	</Sidebar.Content>

	<Sidebar.Footer class="border-t px-3 py-2">
		<a
			href={resolve(bare('/server/check-relations'))}
			class="rounded-md px-2 py-1 text-xs text-muted-foreground outline-hidden hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
			>Configuration storage</a
		>
	</Sidebar.Footer>

	<SidebarResizer {width} />
</Sidebar.Root>
