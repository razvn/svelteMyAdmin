<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { CollationGroup } from './types.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import {
		INDEX_CHOICES,
		getAttributes,
		getVirtualities,
		hasCollation,
		isEnumOrSet,
		isUuidSupported,
		isVirtualColumnsSupported,
		type ColumnDef,
		type DefaultType,
		type IndexChoice,
		type ServerCaps,
		type TypeGroup
	} from '#lib/sql/column-definition.ts';

	interface Props {
		col: ColumnDef;
		/** Zero-based position, used for labels and ids. */
		index: number;
		count: number;
		caps: ServerCaps;
		typeGroups: TypeGroup[];
		collationGroups: CollationGroup[];
		/** Hide the index select (e.g. when changing existing columns). */
		showIndex?: boolean;
		/** Hide the A_I checkbox; defaults to `showIndex`. */
		showAutoIncrement?: boolean;
		/** Existing column being changed: no move / remove buttons. */
		fixed?: boolean;
		onmoveup: () => void;
		onmovedown: () => void;
		onremove: () => void;
		oneditvalues: () => void;
	}

	let {
		col = $bindable(),
		index,
		count,
		caps,
		typeGroups,
		collationGroups,
		showIndex = true,
		showAutoIncrement = showIndex,
		fixed = false,
		onmoveup,
		onmovedown,
		onremove,
		oneditvalues
	}: Props = $props();

	const attributes = $derived(getAttributes(caps));
	const virtualities = $derived(getVirtualities(caps));
	const canVirtual = $derived(isVirtualColumnsSupported(caps));
	const isVirtual = $derived(col.virtuality !== '');
	const defaultOptions = $derived<{ value: DefaultType; label: string }[]>([
		{ value: 'NONE', label: 'None' },
		{ value: 'USER_DEFINED', label: 'As defined:' },
		{ value: 'NULL', label: 'NULL' },
		{ value: 'CURRENT_TIMESTAMP', label: 'CURRENT_TIMESTAMP' },
		...(isUuidSupported(caps) ? [{ value: 'UUID' as const, label: 'UUID' }] : [])
	]);
	const defaultLabel = $derived(
		defaultOptions.find((o) => o.value === col.defaultType)?.label ?? 'None'
	);
	const indexLabel = (v: IndexChoice) => (v === '' ? '---' : v);
	const n = $derived(index + 1);

	function setType(type: string) {
		col.type = type;
		if (!hasCollation(type)) col.collation = '';
	}

	function setDefaultType(type: string) {
		col.defaultType = type as DefaultType;
		// DEFAULT NULL only makes sense for a nullable column (phpMyAdmin ticks "Null" too)
		if (type === 'NULL') col.null = true;
	}

	function setIndex(value: string) {
		col.index = value as IndexChoice;
		if (value === 'PRIMARY') col.null = false;
	}

	function setAutoIncrement(checked: boolean) {
		col.autoIncrement = checked;
		if (checked && col.index === '') col.index = 'PRIMARY';
		if (checked) col.null = false;
	}

	function setVirtuality(value: string) {
		col.virtuality = value === 'NONE' ? '' : value;
		if (col.virtuality !== '') {
			col.defaultType = 'NONE';
			col.autoIncrement = false;
		}
	}
</script>

{#snippet field(label: string, cls: string, body: import('svelte').Snippet)}
	<div class="flex min-w-0 flex-col gap-1 {cls}">
		<span class="text-xs font-medium text-muted-foreground">{label}</span>
		{@render body()}
	</div>
{/snippet}

<div
	role="group"
	aria-label="Column {n}"
	data-testid="column-row-{index}"
	class="grid grid-cols-2 gap-x-3 gap-y-3 rounded-lg border bg-card p-3 md:grid-cols-6 xl:grid-cols-12"
>
	{#snippet nameField()}
		<Input
			bind:value={col.name}
			aria-label="Name"
			placeholder="Column name"
			maxlength={64}
			autocomplete="off"
			class="font-mono"
		/>
	{/snippet}
	{@render field('Name', 'col-span-2 md:col-span-3 xl:col-span-3', nameField)}

	{#snippet typeField()}
		<Select.Root type="single" value={col.type} onValueChange={setType}>
			<Select.Trigger class="w-full" aria-label="Type">{col.type}</Select.Trigger>
			<Select.Content class="max-h-80">
				{#each typeGroups as group (group.label)}
					<Select.Group>
						<Select.GroupHeading>{group.label}</Select.GroupHeading>
						{#each group.types as t (t)}
							<Select.Item value={t} label={t}>{t}</Select.Item>
						{/each}
					</Select.Group>
				{/each}
			</Select.Content>
		</Select.Root>
	{/snippet}
	{@render field('Type', 'col-span-1 md:col-span-3 xl:col-span-2', typeField)}

	{#snippet lengthField()}
		<Input
			bind:value={col.length}
			aria-label="Length/Values"
			placeholder={isEnumOrSet(col.type) ? "'a','b'" : ''}
			autocomplete="off"
			class="font-mono"
		/>
		{#if isEnumOrSet(col.type)}
			<button
				type="button"
				class="self-start text-xs text-primary hover:underline"
				onclick={oneditvalues}
			>
				Edit ENUM/SET values
			</button>
		{/if}
	{/snippet}
	{@render field('Length/Values', 'col-span-1 md:col-span-3 xl:col-span-2', lengthField)}

	{#snippet defaultField()}
		<div class="flex gap-2">
			<Select.Root
				type="single"
				value={col.defaultType}
				onValueChange={setDefaultType}
				disabled={isVirtual}
			>
				<Select.Trigger class="w-full min-w-0 flex-1" aria-label="Default">
					{defaultLabel}
				</Select.Trigger>
				<Select.Content>
					{#each defaultOptions as o (o.value)}
						<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if col.defaultType === 'USER_DEFINED' && !isVirtual}
				<Input
					bind:value={col.defaultValue}
					aria-label="Default value"
					placeholder="Value"
					autocomplete="off"
					class="min-w-0 flex-1 font-mono"
				/>
			{/if}
		</div>
	{/snippet}
	{@render field('Default', 'col-span-2 md:col-span-3 xl:col-span-3', defaultField)}

	{#snippet collationField()}
		<Select.Root
			type="single"
			value={col.collation}
			onValueChange={(v) => (col.collation = v)}
			disabled={!hasCollation(col.type)}
		>
			<Select.Trigger class="w-full" aria-label="Collation">
				<span class="truncate">{col.collation || ' '}</span>
			</Select.Trigger>
			<Select.Content class="max-h-80">
				<Select.Item value="" label="(default)">(default)</Select.Item>
				{#each collationGroups as group (group.charset)}
					<Select.Group>
						<Select.GroupHeading>{group.charset}</Select.GroupHeading>
						{#each group.list as c (c.name)}
							<Select.Item value={c.name} label={c.name}>{c.name}</Select.Item>
						{/each}
					</Select.Group>
				{/each}
			</Select.Content>
		</Select.Root>
	{/snippet}
	{@render field('Collation', 'col-span-1 md:col-span-2 xl:col-span-2', collationField)}

	{#snippet attributeField()}
		<Select.Root
			type="single"
			value={col.attribute}
			onValueChange={(v) => (col.attribute = v === 'NONE' ? '' : v)}
		>
			<Select.Trigger class="w-full" aria-label="Attributes">
				<span class="truncate">{col.attribute || ' '}</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="NONE" label="(none)">(none)</Select.Item>
				{#each attributes as a (a)}
					<Select.Item value={a} label={a}>{a}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/snippet}
	{@render field('Attributes', 'col-span-1 md:col-span-2 xl:col-span-2', attributeField)}

	{#if showIndex}
		{#snippet indexField()}
			<Select.Root type="single" value={col.index} onValueChange={setIndex}>
				<Select.Trigger class="w-full" aria-label="Index">{indexLabel(col.index)}</Select.Trigger>
				<Select.Content>
					{#each INDEX_CHOICES as v (v)}
						<Select.Item value={v} label={indexLabel(v)}>{indexLabel(v)}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/snippet}
		{@render field('Index', 'col-span-1 md:col-span-2 xl:col-span-2', indexField)}
	{/if}

	{#snippet flagsField()}
		<div class="flex h-9 items-center gap-4">
			<label class="flex items-center gap-1.5 text-sm">
				<Checkbox
					checked={col.null}
					onCheckedChange={(v) => (col.null = v === true)}
					aria-label="Null"
				/>
				Null
			</label>
			{#if showAutoIncrement}
				<label class="flex items-center gap-1.5 text-sm" title="AUTO_INCREMENT">
					<Checkbox
						checked={col.autoIncrement}
						onCheckedChange={(v) => setAutoIncrement(v === true)}
						disabled={isVirtual}
						aria-label="A_I"
					/>
					A_I
				</label>
			{/if}
		</div>
	{/snippet}
	{@render field('Null / Auto-increment', 'col-span-1 md:col-span-2 xl:col-span-2', flagsField)}

	{#snippet commentField()}
		<Input bind:value={col.comment} aria-label="Comments" maxlength={1024} autocomplete="off" />
	{/snippet}
	{@render field('Comments', 'col-span-2 md:col-span-4 xl:col-span-4', commentField)}

	{#if canVirtual}
		{#snippet virtualityField()}
			<div class="flex gap-2">
				<Select.Root type="single" value={col.virtuality || 'NONE'} onValueChange={setVirtuality}>
					<Select.Trigger class="w-full min-w-0 flex-1" aria-label="Virtuality">
						<span class="truncate">{col.virtuality || ' '}</span>
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="NONE" label="(none)">(none)</Select.Item>
						{#each virtualities as v (v)}
							<Select.Item value={v} label={v}>{v}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if isVirtual}
					<Input
						bind:value={col.expression}
						aria-label="Expression"
						placeholder="Expression"
						autocomplete="off"
						class="min-w-0 flex-1 font-mono"
					/>
				{/if}
			</div>
		{/snippet}
		{@render field('Virtuality', 'col-span-2 md:col-span-4 xl:col-span-4', virtualityField)}
	{/if}

	{#if !fixed}
		<div class="col-span-2 flex items-end justify-end gap-1 md:col-span-2 xl:col-span-2">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				aria-label="Move column {n} up"
				disabled={index === 0}
				onclick={onmoveup}
			>
				<ArrowUp />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				aria-label="Move column {n} down"
				disabled={index === count - 1}
				onclick={onmovedown}
			>
				<ArrowDown />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				aria-label="Remove column {n}"
				disabled={count <= 1}
				onclick={onremove}
			>
				<Trash2 />
			</Button>
		</div>
	{/if}
</div>
