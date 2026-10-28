<script lang="ts">
	import { page } from '$app/state';
	import TabBar from '#lib/components/app-shell/tab-bar.svelte';
	import { currentTabPath, serverTabs, tabHref } from '#lib/nav/tabs.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Hook for conditional tabs (e.g. "Binary log" when log_bin is ON): pass options here.
	const tabs = serverTabs();
	const current = $derived(currentTabPath('server', {}, page.url.pathname));
</script>

<TabBar label="Server" {tabs} {current} hrefFor={(tab) => tabHref('server', {}, tab.path)} />
{@render children()}
