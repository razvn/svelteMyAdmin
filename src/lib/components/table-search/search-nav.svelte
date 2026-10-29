<script lang="ts">
	import { N_, useI18n } from '#lib/i18n/index.ts';
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import { tabHref } from '#lib/nav/tabs.ts';
	import { tabLinkClass, TAB_STRIP } from '#lib/components/app-shell/tab-styles.ts';
	const { t } = useI18n();

	interface Props {
		db: string;
		table: string;
		current: 'search' | 'zoom-search' | 'find-replace';
	}

	let { db, table, current }: Props = $props();

	const items = [
		{ path: 'search', label: N_('Table search') },
		{ path: 'zoom-search', label: N_('Zoom search') },
		{ path: 'find-replace', label: N_('Find and replace') }
	] as const;
</script>

<nav class="flex w-fit gap-1 {TAB_STRIP}" aria-label={t('Search modes')}>
	{#each items as item (item.path)}
		<a
			href={resolve(bare(tabHref('table', { db, table }, item.path)))}
			class={tabLinkClass(item.path === current)}
			aria-current={item.path === current ? 'page' : undefined}
		>
			{t(item.label)}
		</a>
	{/each}
</nav>
