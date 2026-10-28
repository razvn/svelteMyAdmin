<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { getNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import type { ServerCaps } from '#lib/sql/column-definition.ts';
	import {
		INDEX_KINDS,
		buildSaveIndex,
		validateIndexDef,
		type IndexDef,
		type IndexKind,
		type IndexStorageType
	} from '#lib/sql/index-definition.ts';
	import { alterEnhance } from './alter-enhance.ts';

	interface Props {
		open: boolean;
		/** Existing index being edited (null = create). */
		original: { name: string; kind: IndexKind } | null;
		initial: IndexDef;
		tableColumns: string[];
		caps: ServerCaps;
		db: string;
		table: string;
		canInvisible: boolean;
		invisibleLabel: string;
	}

	let {
		open = $bindable(),
		original,
		initial,
		tableColumns,
		caps,
		db,
		table,
		canInvisible,
		invisibleLabel
	}: Props = $props();

	const navState = getNavState();
	/* The dialog is mounted per use: `initial` only seeds the form. */
	/* svelte-ignore state_referenced_locally */
	let def = $state<IndexDef>(structuredClone($state.snapshot(initial)));
	let busy = $state(false);
	let error = $state('');

	const problem = $derived(validateIndexDef(def, tableColumns));
	const sql = $derived(problem ? '' : buildSaveIndex(db, table, def, original, caps));
	const isPrimary = $derived(def.kind === 'PRIMARY');
	const storageTypes: { value: IndexStorageType; label: string }[] = [
		{ value: '', label: '(default)' },
		{ value: 'BTREE', label: 'BTREE' },
		{ value: 'HASH', label: 'HASH' }
	];

	function setKind(value: string) {
		def.kind = value as IndexKind;
		if (def.kind === 'PRIMARY') def.name = 'PRIMARY';
		else if (def.name === 'PRIMARY') def.name = '';
		if (def.kind === 'FULLTEXT' || def.kind === 'SPATIAL') {
			def.indexType = '';
			for (const c of def.columns) c.size = '';
		}
		if (def.kind !== 'FULLTEXT') def.parser = '';
	}

	function addColumn() {
		def.columns.push({ name: '', size: '' });
	}

	function move(i: number, delta: -1 | 1) {
		const j = i + delta;
		if (j < 0 || j >= def.columns.length) return;
		[def.columns[i], def.columns[j]] = [def.columns[j], def.columns[i]];
	}

	const submit = alterEnhance({
		start: () => {
			busy = true;
			error = '';
		},
		fail: (m) => {
			busy = false;
			error = m;
		},
		success: () => {
			busy = false;
			open = false;
			toast.success(original ? 'The index has been modified.' : 'The index has been created.');
			if (page.params.db) void navState.load(page.params.db, true);
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="index-editor">
		<Dialog.Header>
			<Dialog.Title>{original ? `Edit index ${original.name}` : 'Add index'}</Dialog.Title>
			<Dialog.Description>
				Table {table}. Choose the columns, in order; a sub-part limits how many characters are
				indexed.
			</Dialog.Description>
		</Dialog.Header>

		<form method="POST" action="?/saveIndex" class="flex flex-col gap-4" use:enhance={submit}>
			<input
				type="hidden"
				name="payload"
				value={JSON.stringify({ original: original?.name ?? null, def })}
			/>
			<div class="grid gap-4 md:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="ix-name">Index name</Label>
					<Input
						id="ix-name"
						bind:value={def.name}
						placeholder={isPrimary ? 'PRIMARY' : 'Index name (optional)'}
						disabled={isPrimary}
						maxlength={64}
						autocomplete="off"
						class="font-mono"
					/>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label id="ix-kind-label">Index choice</Label>
					<Select.Root type="single" value={def.kind} onValueChange={setKind}>
						<Select.Trigger class="w-full" aria-labelledby="ix-kind-label">
							{def.kind}
						</Select.Trigger>
						<Select.Content>
							{#each INDEX_KINDS as k (k)}
								<Select.Item value={k} label={k}>{k}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="ix-kbs">Key block size</Label>
					<Input
						id="ix-kbs"
						bind:value={def.keyBlockSize}
						inputmode="numeric"
						placeholder="(default)"
						autocomplete="off"
					/>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label id="ix-type-label">Index type</Label>
					<Select.Root
						type="single"
						value={def.indexType}
						onValueChange={(v) => (def.indexType = v as IndexStorageType)}
						disabled={def.kind === 'FULLTEXT' || def.kind === 'SPATIAL'}
					>
						<Select.Trigger class="w-full" aria-labelledby="ix-type-label">
							{def.indexType || '(default)'}
						</Select.Trigger>
						<Select.Content>
							{#each storageTypes as t (t.value)}
								<Select.Item value={t.value} label={t.label}>{t.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				{#if def.kind === 'FULLTEXT'}
					<div class="flex flex-col gap-1.5">
						<Label for="ix-parser">Parser</Label>
						<Input
							id="ix-parser"
							bind:value={def.parser}
							placeholder="(none)"
							autocomplete="off"
							class="font-mono"
						/>
					</div>
				{/if}
				<div class="flex flex-col gap-1.5 {def.kind === 'FULLTEXT' ? '' : 'md:col-span-2'}">
					<Label for="ix-comment">Comment</Label>
					<Input id="ix-comment" bind:value={def.comment} maxlength={1024} autocomplete="off" />
				</div>
				{#if canInvisible && !isPrimary}
					<label class="flex items-center gap-2 text-sm md:col-span-2">
						<Checkbox
							checked={def.invisible}
							onCheckedChange={(v) => (def.invisible = v === true)}
							aria-label={invisibleLabel}
						/>
						{invisibleLabel}
					</label>
				{/if}
			</div>

			<div class="flex flex-col gap-2" data-testid="index-columns">
				<span class="text-sm font-medium">Columns</span>
				{#each def.columns as c, i (i)}
					<div class="flex items-center gap-2" role="group" aria-label="Index column {i + 1}">
						<Select.Root type="single" value={c.name} onValueChange={(v) => (c.name = v)}>
							<Select.Trigger class="min-w-0 flex-1" aria-label="Column">
								<span class="truncate font-mono">{c.name || 'Choose a column'}</span>
							</Select.Trigger>
							<Select.Content class="max-h-72">
								{#each tableColumns as name (name)}
									<Select.Item value={name} label={name}>{name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<Input
							bind:value={c.size}
							aria-label="Sub-part size"
							placeholder="Size"
							inputmode="numeric"
							disabled={def.kind === 'FULLTEXT' || def.kind === 'SPATIAL'}
							class="w-24"
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Move column {i + 1} up"
							disabled={i === 0}
							onclick={() => move(i, -1)}
						>
							<ArrowUp />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Move column {i + 1} down"
							disabled={i === def.columns.length - 1}
							onclick={() => move(i, 1)}
						>
							<ArrowDown />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Remove column {i + 1}"
							disabled={def.columns.length <= 1}
							onclick={() => def.columns.splice(i, 1)}
						>
							<Trash2 />
						</Button>
					</div>
				{/each}
				<Button type="button" variant="outline" size="sm" class="self-start" onclick={addColumn}>
					<Plus /> Add column
				</Button>
			</div>

			<div>
				<span class="text-sm font-medium">SQL</span>
				<pre
					class="mt-1 max-h-40 overflow-auto rounded-lg border bg-muted p-3 font-mono text-sm whitespace-pre-wrap"
					data-testid="index-sql">{sql || problem}</pre>
			</div>

			{#if error}
				<Alert.Root variant="destructive" role="alert" data-testid="index-error">
					<Alert.Description>{error}</Alert.Description>
				</Alert.Root>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={busy || problem !== null}>Save</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
