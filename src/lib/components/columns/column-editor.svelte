<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import {
		getTypeGroups,
		isIntegersLengthRestricted,
		newColumn,
		type ColumnDef,
		type ServerCaps
	} from '#lib/sql/column-definition.ts';
	import CentralColumnsPicker from './central-columns-picker.svelte';
	import ColumnRow from './column-row.svelte';
	import type { CollationGroup } from './types.ts';
	import EnumValuesDialog from './enum-values-dialog.svelte';

	interface Props {
		columns: ColumnDef[];
		caps: ServerCaps;
		collations: { name: string; charset: string }[];
		/** Hide the index select. */
		showIndex?: boolean;
		/** Hide the A_I checkbox; defaults to `showIndex`. */
		showAutoIncrement?: boolean;
		/**
		 * Edit existing columns (ALTER ... CHANGE): fixed list, no add / remove / reorder controls.
		 */
		fixed?: boolean;
		/** Allow removing the last remaining row (never for CREATE TABLE). */
		minColumns?: number;
		/** Database whose central columns can be picked to fill a row. */
		centralDb?: string;
	}

	let {
		columns = $bindable(),
		caps,
		collations,
		showIndex = true,
		showAutoIncrement = showIndex,
		fixed = false,
		minColumns = 1,
		centralDb
	}: Props = $props();

	const typeGroups = $derived(getTypeGroups(caps));
	const collationGroups = $derived.by(() => {
		const groups: CollationGroup[] = [];
		for (const c of collations) {
			let g = groups.find((x) => x.charset === c.charset);
			if (!g) groups.push((g = { charset: c.charset, list: [] }));
			g.list.push({ name: c.name });
		}
		return groups;
	});

	let toAdd = $state('1');
	let enumIndex = $state<number | null>(null);
	let enumOpen = $state(false);

	function move(i: number, delta: -1 | 1) {
		const j = i + delta;
		if (j < 0 || j >= columns.length) return;
		const next = [...columns];
		[next[i], next[j]] = [next[j], next[i]];
		columns = next;
	}

	function remove(i: number) {
		if (columns.length <= minColumns) return;
		columns = columns.filter((_, k) => k !== i);
	}

	const addCount = $derived(Math.max(1, Math.min(4096 - columns.length, Number(toAdd) || 1)));

	function add() {
		columns = [...columns, ...Array.from({ length: addCount }, () => newColumn())];
	}

	function editValues(i: number) {
		enumIndex = i;
		enumOpen = true;
	}
</script>

<div class="flex flex-col gap-3" data-testid="column-editor">
	{#if isIntegersLengthRestricted(caps)}
		<p class="text-xs text-muted-foreground">
			The width of integer types is ignored by this MySQL version, except for TINYINT(1).
		</p>
	{/if}
	{#if centralDb && !fixed}
		<CentralColumnsPicker db={centralDb} bind:columns />
	{/if}
	{#each columns as col, i (col.id)}
		<ColumnRow
			bind:col={columns[i]}
			index={i}
			count={columns.length}
			{caps}
			{typeGroups}
			{collationGroups}
			{showIndex}
			{showAutoIncrement}
			{fixed}
			onmoveup={() => move(i, -1)}
			onmovedown={() => move(i, 1)}
			onremove={() => remove(i)}
			oneditvalues={() => editValues(i)}
		/>
	{/each}
	{#if !fixed}
		<div class="flex flex-wrap items-center gap-2">
			<Input
				type="number"
				min={1}
				max={4096}
				bind:value={toAdd}
				aria-label="Number of columns to add"
				class="w-20"
			/>
			<Button type="button" variant="outline" onclick={add}>
				<Plus /> Add {addCount} column(s)
			</Button>
		</div>
	{/if}
</div>

{#if enumIndex !== null && columns[enumIndex]}
	<EnumValuesDialog
		bind:open={enumOpen}
		value={columns[enumIndex].length}
		type={columns[enumIndex].type}
		onapply={(v) => {
			if (enumIndex !== null) columns[enumIndex].length = v;
		}}
	/>
{/if}
