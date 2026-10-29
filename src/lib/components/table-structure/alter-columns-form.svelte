<script lang="ts">
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import ColumnEditor from '#lib/components/columns/column-editor.svelte';
	import { getNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { bare } from '#lib/nav/paths.ts';
	import { tabHref } from '#lib/nav/tabs.ts';
	import {
		buildAddColumns,
		buildChangeColumns,
		type ColumnPlacement
	} from '#lib/sql/alter-table.ts';
	import type { ColumnDef, ServerCaps } from '#lib/sql/column-definition.ts';
	import { alterEnhance } from './alter-enhance.ts';

	interface Props {
		mode: 'add' | 'change';
		columns: ColumnDef[];
		caps: ServerCaps;
		collations: { name: string; charset: string }[];
		db: string;
		table: string;
		/** Add mode: where the new columns go. */
		placement?: ColumnPlacement;
		/** Add mode: the table already has a PRIMARY KEY. */
		hasPrimary?: boolean;
	}

	let {
		mode,
		columns: initial,
		caps,
		collations,
		db,
		table,
		placement = { where: 'end' },
		hasPrimary = false
	}: Props = $props();

	const navState = getNavState();
	/* The route data only seeds the form; the user's edits live in local state. */
	/* svelte-ignore state_referenced_locally */
	let columns = $state<ColumnDef[]>(structuredClone($state.snapshot(initial)));
	/* svelte-ignore state_referenced_locally */
	const oldNames = initial.map((c) => c.name);
	let busy = $state(false);
	let error = $state('');
	let previewOpen = $state(false);

	const sql = $derived(
		mode === 'add'
			? buildAddColumns(db, table, columns, caps, placement, { tableHasPrimary: hasPrimary })
			: buildChangeColumns(
					db,
					table,
					columns.map((col, i) => ({ oldName: oldNames[i], col })),
					caps
				)
	);
	const payload = $derived(
		mode === 'add'
			? { columns, placement }
			: { changes: columns.map((col, i) => ({ oldName: oldNames[i], col })) }
	);
	const structureHref = $derived(resolve(bare(tabHref('table', { db, table }, 'structure'))));

	const submit = alterEnhance({
		start: () => {
			busy = true;
			error = '';
		},
		fail: (m) => {
			busy = false;
			error = m;
			previewOpen = false;
		},
		success: async () => {
			busy = false;
			toast.success(
				mode === 'add' ? 'The columns have been added.' : 'The table has been altered successfully.'
			);
			void navState.load(db, true);
			await goto(structureHref);
		}
	});
</script>

<form method="POST" action="?/{mode}" class="flex flex-col gap-6" use:enhance={submit}>
	<input type="hidden" name="payload" value={JSON.stringify(payload)} />

	{#if error}
		<Alert.Root variant="destructive" role="alert" data-testid="alter-error">
			<Alert.Title>Could not alter the table</Alert.Title>
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>{mode === 'add' ? 'New columns' : 'Change columns'}</Card.Title>
			<Card.Description>
				{#if mode === 'add'}
					Columns without a name are skipped. For ENUM and SET enter the values like
					<code class="font-mono">'a','b','c'</code>.
				{:else}
					Rename a column or change its definition. Indexes and foreign keys are kept.
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if mode === 'add'}
				<ColumnEditor bind:columns {caps} {collations} centralDb={db} />
			{:else}
				<ColumnEditor bind:columns {caps} {collations} showIndex={false} showAutoIncrement fixed />
			{/if}
		</Card.Content>
	</Card.Root>

	<div class="flex flex-wrap justify-end gap-2">
		<Button type="button" variant="outline" href={structureHref}>Cancel</Button>
		<Button type="button" variant="outline" onclick={() => (previewOpen = true)}>
			Preview SQL
		</Button>
		<Button type="submit" disabled={busy || !hydration.ready}>Save</Button>
	</div>
</form>

<Dialog.Root bind:open={previewOpen}>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Preview SQL</Dialog.Title>
			<Dialog.Description>The statement that Save will execute.</Dialog.Description>
		</Dialog.Header>
		<pre
			class="max-h-96 overflow-auto rounded-lg border bg-muted p-3 font-mono text-sm whitespace-pre-wrap"
			data-testid="preview-sql">{sql}</pre>
		<Dialog.Footer>
			<Button type="button" onclick={() => (previewOpen = false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
