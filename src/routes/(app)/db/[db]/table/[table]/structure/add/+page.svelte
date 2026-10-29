<script lang="ts">
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import AlterColumnsForm from '#lib/components/table-structure/alter-columns-form.svelte';
	import { newColumn } from '#lib/sql/column-definition.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t, tn } = useI18n();

	let { data }: PageProps = $props();

	const placement = $derived(
		data.where === 'after'
			? ({ where: 'after', after: data.after } as const)
			: ({ where: data.where } as const)
	);
	const where = $derived(
		data.where === 'first'
			? t('at the beginning of the table')
			: data.where === 'after'
				? t('after {column}', { column: data.after })
				: t('at the end of the table')
	);
</script>

<svelte:head><title>{t('Add columns')} - {data.table}</title></svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Columns3}
		title={t('Add columns')}
		description="{data.db}.{data.table} · {tn(
			'{n} new column',
			'{n} new columns',
			data.num
		)} {where}"
	/>
	<AlterColumnsForm
		mode="add"
		columns={Array.from({ length: data.num }, () => newColumn())}
		caps={data.caps}
		collations={data.collations}
		db={data.db}
		table={data.table}
		transformUi={data.transformUi}
		{placement}
		hasPrimary={data.hasPrimary}
	/>
</div>
