<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { TAB_STRIP, tabLinkClass } from '#lib/components/app-shell/tab-styles.ts';
	import { activeStatusSubTab, STATUS_SUB_TABS } from '#lib/admin/status-tabs.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { LayoutProps } from './$types';

	const { t } = useI18n();
	let { children }: LayoutProps = $props();

	const active = $derived(activeStatusSubTab(page.url.pathname));
</script>

<div class="flex flex-col gap-6">
	<PageHeader
		title={t('Server status')}
		description={t('Live counters since the last server start or FLUSH STATUS.')}
	/>
	<nav aria-label={t('Status')} class="flex flex-wrap gap-1 {TAB_STRIP}" data-testid="status-subnav">
		{#each STATUS_SUB_TABS as tab (tab.id)}
			<a
				href={resolve(bare(`/server/status${tab.path ? `/${tab.path}` : ''}`))}
				aria-current={active === tab.id ? 'page' : undefined}
				class={tabLinkClass(active === tab.id)}
			>
				{t(tab.label)}
			</a>
		{/each}
	</nav>
	{@render children()}
</div>
