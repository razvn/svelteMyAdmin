<script lang="ts">
	import { page } from '$app/state';
	import TabBar from '#lib/components/app-shell/tab-bar.svelte';
	import { currentTabPath, dbTabs, tabHref } from '#lib/nav/tabs.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const tabs = dbTabs();
	const current = $derived(currentTabPath('db', { db: data.db }, page.url.pathname));
</script>

{#if !page.params.table}
	<TabBar
		label="Database"
		{tabs}
		{current}
		hrefFor={(tab) => tabHref('db', { db: data.db }, tab.path)}
	/>
{/if}
{@render children()}
