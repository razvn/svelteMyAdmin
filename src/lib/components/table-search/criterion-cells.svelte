<script lang="ts">
	import { untrack } from 'svelte';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { isRangeOperator, isUnaryOperator } from '#lib/sql/table-operators.ts';
	import type { SearchColumn } from '#lib/server/table/search.ts';
	import NativeSelect from './native-select.svelte';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		column: SearchColumn;
		/** Suffix of the field names: `op_<key>`, `val_<key>`, `val2_<key>`, `geom_<key>`. */
		key: string | number;
		/** Show the geometry function column (the table has spatial columns). */
		withGeometry?: boolean;
		/** Values to start from (the criteria of the current request). */
		initial?: { operator?: string; values?: string[]; value2?: string; geomFunc?: string };
	}

	let { column, key, withGeometry = false, initial = {} }: Props = $props();

	const first = $derived(initial.values?.[0] ?? '');

	let operator = $state(
		untrack(() =>
			initial.operator && column.operators.includes(initial.operator)
				? initial.operator
				: column.operators[0]
		)
	);
	let geomFunc = $state(untrack(() => initial.geomFunc ?? ''));
	// The first operator of the list is the default, like in phpMyAdmin.
	const op = $derived(operator);
	const unary = $derived(isUnaryOperator(op));
	const range = $derived(isRangeOperator(op));
	const label = $derived(column.name);
</script>

{#if withGeometry}
	<Table.Cell>
		{#if column.isGeometry}
			<NativeSelect name="geom_{key}" bind:value={geomFunc} aria-label={t('Function for {name}', { name: label })}>
				<option value=""></option>
				{#each column.geomFuncs as f (f.name)}
					<option value={f.name}>{f.name}</option>
				{/each}
			</NativeSelect>
		{/if}
	</Table.Cell>
{/if}
<Table.Cell>
	<NativeSelect name="op_{key}" bind:value={operator} aria-label={t('Operator for {name}', { name: label })}>
		{#each column.operators as o (o)}
			<option value={o}>{o}</option>
		{/each}
	</NativeSelect>
</Table.Cell>
<Table.Cell>
	{#if unary}
		<span class="text-muted-foreground">-</span>
	{:else if range}
		<div class="flex items-center gap-2">
			<Input
				name="val_{key}"
				value={first}
				aria-label={t('Minimum for {name}', { name: label })}
				class="w-36"
				autocomplete="off"
			/>
			<span class="text-muted-foreground">{t('and')}</span>
			<Input
				name="val2_{key}"
				value={initial.value2 ?? ''}
				aria-label={t('Maximum for {name}', { name: label })}
				class="w-36"
				autocomplete="off"
			/>
		</div>
	{:else if column.enumValues}
		<NativeSelect
			name="val_{key}"
			multiple
			size={Math.min(3, Math.max(column.enumValues.length, 1))}
			class="h-auto min-w-40"
			aria-label={t('Value for {name}', { name: label })}
		>
			{#each column.enumValues as v (v)}
				<option value={v} selected={initial.values?.includes(v)}>{v}</option>
			{/each}
		</NativeSelect>
	{:else if column.foreign && !geomFunc && op !== 'IN (...)' && op !== 'NOT IN (...)'}
		<NativeSelect name="val_{key}" class="max-w-64" aria-label={t('Value for {name}', { name: label })}>
			<option value=""></option>
			{#each column.foreign as f (f.value)}
				<option value={f.value} selected={f.value === first}>{f.label}</option>
			{/each}
		</NativeSelect>
	{:else}
		<Input
			name="val_{key}"
			value={first}
			class="w-72"
			autocomplete="off"
			aria-label={t('Value for {name}', { name: label })}
			placeholder={column.isGeometry
				? 'POINT(1 2)'
				: op === 'IN (...)' || op === 'NOT IN (...)'
					? 'a,b,c'
					: ''}
		/>
	{/if}
</Table.Cell>
