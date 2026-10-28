<script lang="ts">
	import { page } from '$app/state';
	import TabBar from '#lib/components/app-shell/tab-bar.svelte';
	import { currentTabPath, serverTabs, tabHref } from '#lib/nav/tabs.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// "Binary log" is only shown when log_bin is ON.
	const tabs = $derived(serverTabs({ binlog: data.binlog }));
	const current = $derived(currentTabPath('server', {}, page.url.pathname));
</script>

<TabBar label="Server" {tabs} {current} hrefFor={(tab) => tabHref('server', {}, tab.path)} />
{@render children()}
