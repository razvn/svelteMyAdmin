<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import AlterColumnsForm from '#lib/components/table-structure/alter-columns-form.svelte';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{t('Change columns')} - {data.table}</title></svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Pencil}
		title={t('Change')}
		description="{data.db}.{data.table} · {data.columns.map((c) => c.name).join(', ')}"
	/>
	<AlterColumnsForm
		mode="change"
		columns={data.columns}
		caps={data.caps}
		collations={data.collations}
		db={data.db}
		table={data.table}
		transformUi={data.transformUi}
	/>
</div>
