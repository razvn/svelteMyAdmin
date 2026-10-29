<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import type { Cell } from './format.ts';
	import type { GridColumn } from './types.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		column: GridColumn;
		cell: Cell;
		error?: string | null;
		saving?: boolean;
		onsave: (value: string | null) => void;
		oncancel: () => void;
	}

	let { column, cell, error = null, saving = false, onsave, oncancel }: Props = $props();

	// The editor starts from the cell it was opened for.
	// svelte-ignore state_referenced_locally
	let value = $state(typeof cell === 'string' ? cell : '');
	// svelte-ignore state_referenced_locally
	let isNull = $state(cell === null);

	const multiline = $derived(
		column.kind === 'json' ||
			(column.kind === 'text' && /text/i.test(column.type ?? '')) ||
			value.includes('\n')
	);
	const idBase = $derived(`edit-${column.name}`);

	function save() {
		onsave(isNull ? null : value);
	}

	function keydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			oncancel();
		} else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			save();
		}
	}

	function focus(node: HTMLElement) {
		node.focus();
		if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) node.select();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="flex min-w-48 flex-col gap-2"
	role="group"
	aria-label={t('Edit {name}', { name: column.name })}
	onkeydown={keydown}
>
	{#if column.kind === 'enum' && column.enumValues}
		<Select.Root type="single" bind:value disabled={isNull}>
			<Select.Trigger class="w-full" aria-label={t('{name} value', { name: column.name })}
				>{value || t('Select…')}</Select.Trigger
			>
			<Select.Content>
				{#each column.enumValues as option (option)}
					<Select.Item value={option} label={option}>{option}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{:else if multiline}
		<Textarea
			{@attach focus}
			id={idBase}
			aria-label={t('{name} value', { name: column.name })}
			rows={4}
			class="font-mono text-xs"
			disabled={isNull}
			bind:value
		/>
	{:else}
		<Input
			{@attach focus}
			id={idBase}
			aria-label={t('{name} value', { name: column.name })}
			disabled={isNull}
			placeholder={column.kind === 'set' ? t('comma separated values') : ''}
			bind:value
		/>
	{/if}
	{#if column.nullable}
		<div class="flex items-center gap-2">
			<Checkbox id="{idBase}-null" bind:checked={isNull} aria-label="NULL" />
			<Label for="{idBase}-null" class="text-xs font-normal">NULL</Label>
		</div>
	{/if}
	{#if error}
		<p class="text-xs text-destructive" role="alert">{error}</p>
	{/if}
	<div class="flex gap-2">
		<Button size="sm" onclick={save} disabled={saving}>{t('Save')}</Button>
		<Button size="sm" variant="outline" onclick={oncancel} disabled={saving}>{t('Cancel')}</Button>
	</div>
</div>
