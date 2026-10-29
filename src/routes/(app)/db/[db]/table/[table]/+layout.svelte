<script lang="ts">
	import { page } from '$app/state';
	import TabBar from '#lib/components/app-shell/tab-bar.svelte';
	import { currentTabPath, tabHref, tableTabs } from '#lib/nav/tabs.ts';
	import { filterTabs } from '#lib/nav/user-groups.ts';
	import type { LayoutProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	let { data, children }: LayoutProps = $props();

	const ctx = $derived({ db: page.params.db ?? '', table: data.table });
	const tabs = $derived(
		filterTabs('table', tableTabs({ isView: data.tableType === 'view' }), data.deniedTabs)
	);
	const current = $derived(currentTabPath('table', ctx, page.url.pathname));
</script>

<TabBar
	label={data.tableType === 'view' ? t('View') : t('Table')}
	{tabs}
	{current}
	hrefFor={(tab) => tabHref('table', ctx, tab.path)}
/>
{@render children()}
