<script lang="ts">
	import { onMount } from 'svelte';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import type { CentralColumn } from '#lib/sql/central-columns.ts';
	import { toColumnDef } from '#lib/sql/central-columns.ts';
	import type { ColumnDef } from '#lib/sql/column-definition.ts';

	interface Props {
		db: string;
		columns: ColumnDef[];
	}

	let { db, columns = $bindable() }: Props = $props();

	let list = $state<CentralColumn[]>([]);
	let value = $state('');

	onMount(async () => {
		try {
			const res = await fetch(`/api/central-columns?db=${encodeURIComponent(db)}`);
			if (res.ok) list = ((await res.json()) as { columns: CentralColumn[] }).columns;
		} catch {
			// no central list available
		}
	});

	/** Fill the first unnamed row (or append one) with the chosen definition. */
	function pick(name: string) {
		const found = list.find((c) => c.name === name);
		value = '';
		if (!found) return;
		const def = toColumnDef(found);
		const empty = columns.findIndex((c) => c.name.trim() === '');
		if (empty >= 0) {
			columns[empty] = { ...def, id: columns[empty].id };
		} else {
			columns = [...columns, def];
		}
	}
</script>

{#if list.length > 0}
	<div class="flex items-center gap-2" data-testid="central-picker">
		<NativeSelect
			bind:value
			aria-label="Pick from central columns"
			class="max-w-xs"
			onchange={() => pick(value)}
		>
			<NativeSelectOption value="">Pick from central columns</NativeSelectOption>
			{#each list as c (c.name)}
				<NativeSelectOption value={c.name}>{c.name} ({c.type})</NativeSelectOption>
			{/each}
		</NativeSelect>
	</div>
{/if}
