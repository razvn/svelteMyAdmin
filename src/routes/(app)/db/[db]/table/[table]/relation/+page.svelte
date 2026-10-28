<script lang="ts">
	import { deserialize } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import FkEditorDialog from '#lib/components/table-structure/fk-editor-dialog.svelte';
	import SqlConfirmDialog from '#lib/components/table-structure/sql-confirm-dialog.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { buildDropForeignKey, newFkDef, type FkDef } from '#lib/sql/foreign-key.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const base = $derived(
		`/db/${encodeURIComponent(data.db)}/table/${encodeURIComponent(data.table)}`
	);

	// --- foreign keys ---
	let editor = $state<{ original: FkDef | null; initial: FkDef } | null>(null);
	let editorOpen = $state(false);
	function openEditor(original: FkDef | null) {
		editor = {
			original,
			initial: original ? structuredClone($state.snapshot(original)) : newFkDef({ refDb: data.db })
		};
		editorOpen = true;
	}

	let dropTarget = $state<FkDef | null>(null);
	let dropOpen = $state(false);
	function askDrop(fk: FkDef) {
		dropTarget = fk;
		dropOpen = true;
	}

	// --- configuration storage actions ---
	async function post(action: string, payload: unknown, message: string): Promise<boolean> {
		const body = new FormData();
		body.set('payload', JSON.stringify(payload));
		try {
			const res = await fetch(`?/${action}`, {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await res.text());
			if (result.type === 'success') {
				toast.success(message);
				await refreshAll();
				return true;
			}
			toast.error(
				result.type === 'failure' ? String(result.data?.error ?? 'Failed.') : 'Unexpected error.'
			);
		} catch {
			toast.error('Unexpected error.');
		}
		return false;
	}

	async function getJson<T>(params: Record<string, string>): Promise<T | null> {
		try {
			const res = await fetch(`${base}/relation/targets?${new URLSearchParams(params)}`);
			return res.ok ? ((await res.json()) as T) : null;
		} catch {
			return null;
		}
	}

	let relColumn = $state('');
	let relDb = $state('');
	let relTable = $state('');
	let relRefColumn = $state('');
	let relTables = $state<string[]>([]);
	let relColumns = $state<string[]>([]);
	async function pickRelDb(v: string) {
		relDb = v;
		relTable = '';
		relRefColumn = '';
		relColumns = [];
		relTables = (await getJson<{ tables: string[] }>({ db: v }))?.tables ?? [];
	}
	async function pickRelTable(v: string) {
		relTable = v;
		relRefColumn = '';
		relColumns = (await getJson<{ columns: string[] }>({ db: relDb, table: v }))?.columns ?? [];
	}
	async function saveRelation() {
		const ok = await post(
			'saveInternal',
			{ column: relColumn, refDb: relDb, refTable: relTable, refColumn: relRefColumn },
			'The internal relation has been saved.'
		);
		if (ok) {
			relColumn = relDb = relTable = relRefColumn = '';
		}
	}

	let displayColumn = $derived(data.displayField);
</script>

<svelte:head><title>Relation view - {data.table}</title></svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader icon={ArrowLeftRight} title="Relation view" description="{data.db}.{data.table}">
		{#snippet actions()}
			<Button variant="outline" href="{base}/structure">Back to structure</Button>
		{/snippet}
	</PageHeader>

	{#if data.isView}
		<Alert.Root><Alert.Description>A view has no relations.</Alert.Description></Alert.Root>
	{:else}
		<Card.Root class="gap-0 py-0" data-testid="fk-card">
			<Card.Header class="flex-row items-center justify-between border-b py-5">
				<div>
					<Card.Title>Foreign key constraints</Card.Title>
					<Card.Description>Storage engine: {data.engine ?? 'unknown'}</Card.Description>
				</div>
				<Button size="sm" onclick={() => openEditor(null)} disabled={!data.fkSupported}>
					<Plus /> Add foreign key
				</Button>
			</Card.Header>
			{#if !data.fkSupported}
				<Card.Content class="py-5">
					<Alert.Root>
						<Alert.Description>
							Foreign keys need the InnoDB storage engine; this table uses {data.engine ??
								'an unknown engine'}.
						</Alert.Description>
					</Alert.Root>
				</Card.Content>
			{:else if data.foreignKeys.length === 0}
				<Card.Content class="py-5 text-sm text-muted-foreground">
					No foreign key defined.
				</Card.Content>
			{:else}
				<Table.Root data-testid="fk-table">
					<Table.Header>
						<Table.Row>
							<Table.Head>Actions</Table.Head>
							<Table.Head>Constraint name</Table.Head>
							<Table.Head>Column</Table.Head>
							<Table.Head>Referenced</Table.Head>
							<Table.Head>ON DELETE</Table.Head>
							<Table.Head>ON UPDATE</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.foreignKeys as fk (fk.name)}
							<Table.Row data-testid="fk-row-{fk.name}" class="align-top">
								<Table.Cell>
									<div class="flex gap-0.5">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Edit foreign key {fk.name}"
											onclick={() => openEditor(fk)}
										>
											<Pencil />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Drop foreign key {fk.name}"
											onclick={() => askDrop(fk)}
										>
											<Trash2 />
										</Button>
									</div>
								</Table.Cell>
								<Table.Cell class="font-mono font-medium">{fk.name}</Table.Cell>
								<Table.Cell class="font-mono text-xs">
									{#each fk.columns as c (c)}<div>{c}</div>{/each}
								</Table.Cell>
								<Table.Cell class="font-mono text-xs">
									{#each fk.refColumns as c, i (i)}
										<div>{fk.refDb}.{fk.refTable}.{c}</div>
									{/each}
								</Table.Cell>
								<Table.Cell class="text-xs">{fk.onDelete || 'RESTRICT'}</Table.Cell>
								<Table.Cell class="text-xs">{fk.onUpdate || 'RESTRICT'}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</Card.Root>

		{#if data.storage.relation}
			<Card.Root class="gap-0 py-0" data-testid="internal-card">
				<Card.Header class="border-b py-5">
					<Card.Title>Internal relations</Card.Title>
					<Card.Description>
						Stored in the configuration storage (not enforced by the server).
					</Card.Description>
				</Card.Header>
				{#if data.internal.length > 0}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Column</Table.Head>
								<Table.Head>Referenced</Table.Head>
								<Table.Head class="w-12"></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.internal as r (r.column)}
								<Table.Row>
									<Table.Cell class="font-mono">{r.column}</Table.Cell>
									<Table.Cell class="font-mono text-xs">
										{r.refDb}.{r.refTable}.{r.refColumn}
									</Table.Cell>
									<Table.Cell>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Remove internal relation of {r.column}"
											onclick={() =>
												post(
													'saveInternal',
													{ column: r.column, refDb: '', refTable: '', refColumn: '' },
													'The internal relation has been removed.'
												)}
										>
											<Trash2 />
										</Button>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
				<div class="flex flex-wrap items-center gap-2 border-t p-4">
					<Select.Root type="single" value={relColumn} onValueChange={(v) => (relColumn = v)}>
						<Select.Trigger class="w-44" aria-label="Internal relation column">
							<span class="truncate font-mono">{relColumn || 'Column'}</span>
						</Select.Trigger>
						<Select.Content class="max-h-72">
							{#each data.columns as c (c)}
								<Select.Item value={c} label={c}>{c}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<span class="text-muted-foreground" aria-hidden="true">→</span>
					<Select.Root type="single" value={relDb} onValueChange={pickRelDb}>
						<Select.Trigger class="w-44" aria-label="Internal relation database">
							<span class="truncate font-mono">{relDb || 'Database'}</span>
						</Select.Trigger>
						<Select.Content class="max-h-72">
							{#each data.databases as d (d)}
								<Select.Item value={d} label={d}>{d}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<Select.Root
						type="single"
						value={relTable}
						onValueChange={pickRelTable}
						disabled={relDb === ''}
					>
						<Select.Trigger class="w-44" aria-label="Internal relation table">
							<span class="truncate font-mono">{relTable || 'Table'}</span>
						</Select.Trigger>
						<Select.Content class="max-h-72">
							{#each relTables as t (t)}
								<Select.Item value={t} label={t}>{t}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<Select.Root
						type="single"
						value={relRefColumn}
						onValueChange={(v) => (relRefColumn = v)}
						disabled={relTable === ''}
					>
						<Select.Trigger class="w-44" aria-label="Internal relation referenced column">
							<span class="truncate font-mono">{relRefColumn || 'Column'}</span>
						</Select.Trigger>
						<Select.Content class="max-h-72">
							{#each relColumns as c (c)}
								<Select.Item value={c} label={c}>{c}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<Button
						size="sm"
						disabled={!relColumn || !relDb || !relTable || !relRefColumn}
						onclick={saveRelation}
					>
						Save relation
					</Button>
				</div>
			</Card.Root>
		{/if}

		{#if data.storage.tableInfo}
			<Card.Root data-testid="display-card">
				<Card.Header>
					<Card.Title>Choose column to display</Card.Title>
					<Card.Description>
						Shown instead of the key when other tables link to this one.
					</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-wrap items-center gap-2">
					<Select.Root
						type="single"
						value={displayColumn}
						onValueChange={(v) => (displayColumn = v === '__none' ? '' : v)}
					>
						<Select.Trigger class="w-56" aria-label="Column to display">
							<span class="truncate font-mono">{displayColumn || '(none)'}</span>
						</Select.Trigger>
						<Select.Content class="max-h-72">
							<Select.Item value="__none" label="(none)">(none)</Select.Item>
							{#each data.columns as c (c)}
								<Select.Item value={c} label={c}>{c}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<Button
						size="sm"
						onclick={() =>
							post('saveDisplay', { column: displayColumn }, 'The display column has been saved.')}
					>
						Save
					</Button>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>

{#if editor && editorOpen}
	<FkEditorDialog
		bind:open={editorOpen}
		original={editor.original}
		initial={editor.initial}
		columns={data.columns}
		databases={data.databases}
		db={data.db}
		table={data.table}
		{base}
	/>
{/if}

{#if dropTarget}
	<SqlConfirmDialog
		bind:open={dropOpen}
		title="Drop foreign key {dropTarget.name}"
		description="Do you really want to execute the following query?"
		sql={buildDropForeignKey(data.db, data.table, dropTarget.name)}
		action="dropFk"
		payload={{ name: dropTarget.name }}
		label="Drop"
		destructive
		message="The foreign key has been dropped."
		refreshTree={false}
	/>
{/if}
