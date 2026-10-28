<script lang="ts">
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import AlterColumnsForm from '#lib/components/table-structure/alter-columns-form.svelte';
	import { newColumn } from '#lib/sql/column-definition.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const placement = $derived(
		data.where === 'after'
			? ({ where: 'after', after: data.after } as const)
			: ({ where: data.where } as const)
	);
	const where = $derived(
		data.where === 'first'
			? 'at the beginning of the table'
			: data.where === 'after'
				? `after ${data.after}`
				: 'at the end of the table'
	);
</script>

<svelte:head><title>Add columns - {data.table}</title></svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Columns3}
		title="Add columns"
		description="{data.db}.{data.table} · {data.num} new {data.num === 1
			? 'column'
			: 'columns'} {where}"
	/>
	<AlterColumnsForm
		mode="add"
		columns={Array.from({ length: data.num }, () => newColumn())}
		caps={data.caps}
		collations={data.collations}
		db={data.db}
		table={data.table}
		{placement}
		hasPrimary={data.hasPrimary}
	/>
</div>
