<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { buildMoveColumns } from '#lib/sql/alter-table.ts';
	import type { ColumnDef, ServerCaps } from '#lib/sql/column-definition.ts';
	import SqlConfirmDialog from './sql-confirm-dialog.svelte';

	interface Props {
		open: boolean;
		columns: ColumnDef[];
		caps: ServerCaps;
		db: string;
		table: string;
	}

	let { open = $bindable(), columns, caps, db, table }: Props = $props();

	/* Mounted per use: the current order only seeds the list. */
	/* svelte-ignore state_referenced_locally */
	let order = $state(columns.map((c) => c.name));
	let dragFrom = $state<number | null>(null);
	let confirmOpen = $state(false);

	const sql = $derived(buildMoveColumns(db, table, columns, order, caps));

	function move(from: number, to: number) {
		if (to < 0 || to >= order.length || from === to) return;
		const next = [...order];
		const [item] = next.splice(from, 1);
		next.splice(to, 0, item);
		order = next;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="move-columns">
		<Dialog.Header>
			<Dialog.Title>Move columns</Dialog.Title>
			<Dialog.Description>
				Drag the columns, or use the arrows, to set the new order.
			</Dialog.Description>
		</Dialog.Header>
		<ol class="flex flex-col gap-1" aria-label="Column order">
			{#each order as name, i (name)}
				<li
					class="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 {dragFrom === i
						? 'opacity-50'
						: ''}"
					draggable="true"
					ondragstart={() => (dragFrom = i)}
					ondragover={(e) => e.preventDefault()}
					ondrop={(e) => {
						e.preventDefault();
						if (dragFrom !== null) move(dragFrom, i);
						dragFrom = null;
					}}
					ondragend={() => (dragFrom = null)}
					data-testid="move-item-{name}"
				>
					<GripVertical
						class="size-4 shrink-0 cursor-grab text-muted-foreground"
						aria-hidden="true"
					/>
					<span class="w-6 text-sm text-muted-foreground">{i + 1}</span>
					<span class="min-w-0 flex-1 truncate font-mono text-sm">{name}</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Move {name} up"
						disabled={i === 0}
						onclick={() => move(i, i - 1)}
					>
						<ArrowUp />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Move {name} down"
						disabled={i === order.length - 1}
						onclick={() => move(i, i + 1)}
					>
						<ArrowDown />
					</Button>
				</li>
			{/each}
		</ol>
		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button type="button" disabled={sql === ''} onclick={() => (confirmOpen = true)}>
				Preview SQL
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<SqlConfirmDialog
	bind:open={confirmOpen}
	title="Move columns"
	description="The statement that will be executed."
	{sql}
	action="move"
	payload={{ order }}
	label="Move"
	message="The columns have been moved."
	onsuccess={() => (open = false)}
/>
