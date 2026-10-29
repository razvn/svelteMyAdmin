<script lang="ts">
	import { page } from '$app/state';
	import TabBar from '#lib/components/app-shell/tab-bar.svelte';
	import { currentTabPath, serverTabs, tabHref } from '#lib/nav/tabs.ts';
	import { filterTabs } from '#lib/nav/user-groups.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { LayoutProps } from './$types';

	const { t } = useI18n();
	let { data, children }: LayoutProps = $props();

	// "Binary log" is only shown when log_bin is ON.
	const tabs = $derived(filterTabs('server', serverTabs({ binlog: data.binlog }), data.deniedTabs));
	const current = $derived(currentTabPath('server', {}, page.url.pathname));
</script>

<TabBar label={t('Server')} {tabs} {current} hrefFor={(tab) => tabHref('server', {}, tab.path)} />
{@render children()}
