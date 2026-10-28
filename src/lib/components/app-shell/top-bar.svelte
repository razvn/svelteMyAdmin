<script lang="ts">
	import LogOut from '@lucide/svelte/icons/log-out';
	import Search from '@lucide/svelte/icons/search';
	import ThemeToggle from '#lib/components/theme-toggle.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import { Separator } from '#lib/components/ui/separator/index.ts';
	import type { NavConfig } from '#lib/nav/config.ts';
	import Breadcrumbs from './breadcrumbs.svelte';
	import ServerSwitcher from './server-switcher.svelte';

	interface Props {
		nav: NavConfig;
		session: {
			user: string;
			host: string;
			serverLabel: string;
			serverIndex: number;
			canLogout: boolean;
		};
		servers: { index: number; label: string; auth: string }[];
		db?: string;
		table?: string;
		tableType?: 'table' | 'view';
		onsearch: () => void;
	}

	let { nav, session, servers, db, table, tableType, onsearch }: Props = $props();
</script>

<header
	class="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur"
>
	<Sidebar.Trigger />
	<Separator orientation="vertical" class="h-5" />
	<div class="min-w-0 flex-1 overflow-hidden">
		<Breadcrumbs {nav} serverLabel={session.serverLabel} {db} {table} {tableType} />
	</div>

	<Button
		variant="outline"
		size="sm"
		class="gap-2 text-muted-foreground"
		onclick={onsearch}
		aria-label="Open command palette"
		aria-keyshortcuts="Control+K Meta+K"
	>
		<Search />
		<span class="hidden lg:inline" aria-hidden="true">Jump to...</span>
		<kbd
			class="hidden rounded border bg-muted px-1.5 font-mono text-xs lg:inline"
			aria-hidden="true"
		>
			Ctrl K
		</kbd>
	</Button>

	{#if servers.length > 1}
		<ServerSwitcher {servers} current={session.serverIndex} />
	{/if}
	<ThemeToggle />
	<span class="hidden text-sm text-muted-foreground xl:inline" data-testid="connection-info">
		<span class="font-medium text-foreground">{session.user}@{session.host}</span>
	</span>
	{#if session.canLogout}
		<form method="POST" action="/logout">
			<Button type="submit" variant="outline" size="sm" aria-label="Log out">
				<LogOut />
				<span class="hidden lg:inline" aria-hidden="true">Log out</span>
			</Button>
		</form>
	{/if}
</header>
