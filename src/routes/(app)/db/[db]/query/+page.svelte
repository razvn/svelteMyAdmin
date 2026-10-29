<script lang="ts">
	import { resolve } from '$app/paths';
	import Blocks from '@lucide/svelte/icons/blocks';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import MultiTableForm from '#lib/components/query/multi-table-form.svelte';
	import QbeForm from '#lib/components/query/qbe-form.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import * as Tabs from '#lib/components/ui/tabs/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import { bare } from '#lib/nav/paths.ts';
	import { tabHref } from '#lib/nav/tabs.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { t } = useI18n();

	const sqlHref = $derived(resolve(bare(tabHref('db', { db: data.db }, 'sql'))));
</script>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Blocks}
		title={t('Query')}
		description={t('Build a query on database {db} without writing SQL.', { db: data.db })}
	/>

	{#if data.schema.tables.length === 0}
		<Alert role="alert"
			><AlertDescription>{t('No tables found in database.')}</AlertDescription></Alert
		>
	{:else}
		<Tabs.Root value="multi">
			<Tabs.List>
				<Tabs.Trigger value="multi">{t('Multi-table query')}</Tabs.Trigger>
				<Tabs.Trigger value="qbe">{t('Query by example')}</Tabs.Trigger>
			</Tabs.List>
			<Tabs.Content value="multi" class="pt-4">
				<MultiTableForm db={data.db} schema={data.schema} {sqlHref} />
			</Tabs.Content>
			<Tabs.Content value="qbe" class="pt-4">
				<QbeForm db={data.db} schema={data.schema} savedSearches={data.savedSearches} {sqlHref} />
			</Tabs.Content>
		</Tabs.Root>
	{/if}
</div>
