<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Zap from '@lucide/svelte/icons/zap';
	import { page } from '$app/state';
	import { refreshAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { matchesFilter } from '#lib/admin/filter.ts';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import SqlEditor from '#lib/components/sql-editor/sql-editor.svelte';
	import { callAction } from '#lib/forms/call-action.ts';
	import { TRIGGER_EVENTS, TRIGGER_TIMINGS } from '#lib/sql/trigger-types.ts';
	import type { TriggerDef } from '#lib/sql/trigger.ts';
	import ConfirmDrop from './confirm-drop.svelte';
	import SelectField from './select-field.svelte';
	import SqlDialog from './sql-dialog.svelte';

	interface TriggerRow {
		name: string;
		table: string;
		event: string;
		timing: string;
		definer: string;
	}

	interface Props {
		triggers: TriggerRow[];
		/** Tables of the database, for the table picker. */
		tables: string[];
		/** Set on the table-level tab: the table is fixed. */
		fixedTable: string | null;
	}

	let { triggers, tables, fixedTable }: Props = $props();

	const blank = (): TriggerDef => ({
		name: '',
		table: fixedTable ?? '',
		timing: 'BEFORE',
		event: 'INSERT',
		definition: '',
		definer: ''
	});

	let filter = $state('');
	const visible = $derived(
		triggers.filter((t) => matchesFilter(filter, t.name, t.table, t.event, t.timing, t.definer))
	);

	let editorOpen = $state(false);
	let def = $state<TriggerDef>(blank());
	let original = $state<string | null>(null);
	let errors = $state<string[]>([]);
	let saving = $state(false);

	let exportOpen = $state(false);
	let exportTitle = $state('');
	let exportSql = $state('');
	let dropOpen = $state(false);
	let dropName = $state('');
	let dropping = $state(false);

	function openAdd() {
		def = blank();
		original = null;
		errors = [];
		editorOpen = true;
	}

	async function openEdit(name: string) {
		const res = await callAction<{ trigger: TriggerDef }>(page.url.pathname, 'get', { name });
		if (!res.ok || !res.data?.trigger) return void toast.error(res.message ?? 'Trigger not found.');
		def = res.data.trigger;
		original = name;
		errors = [];
		editorOpen = true;
	}

	async function openExport(name: string) {
		const res = await callAction<{ sql: string }>(page.url.pathname, 'export', { name });
		if (!res.ok || !res.data?.sql) return void toast.error(res.message ?? 'Export failed.');
		exportTitle = `Export of trigger ${name}`;
		exportSql = res.data.sql;
		exportOpen = true;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		errors = [];
		const res = await callAction<{ errors?: string[] }>(page.url.pathname, 'save', {
			payload: JSON.stringify($state.snapshot(def)),
			original: original ?? ''
		});
		saving = false;
		if (res.ok) {
			editorOpen = false;
			toast.success(`Trigger ${def.name} has been saved.`);
			await refreshAll();
		} else {
			errors = res.data?.errors ?? [res.message ?? 'Saving the trigger failed.'];
		}
	}

	async function confirmDrop() {
		dropping = true;
		const res = await callAction(page.url.pathname, 'drop', { name: dropName });
		dropping = false;
		if (res.ok) {
			toast.success(`Trigger ${dropName} has been dropped.`);
			dropOpen = false;
			await refreshAll();
		} else toast.error(res.message ?? 'Drop failed.');
	}
</script>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Zap}
		title="Triggers"
		description={fixedTable ? `Triggers on ${fixedTable}.` : `Triggers of ${page.params.db}.`}
	>
		{#snippet actions()}
			<Button onclick={openAdd} data-testid="trigger-add"><Plus /> Add trigger</Button>
		{/snippet}
	</PageHeader>

	<Card.Root class="gap-0 py-0">
		<div class="flex flex-wrap items-center justify-between gap-3 border-b p-5">
			<div class="relative w-full max-w-sm">
				<Search class="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					class="ps-8"
					placeholder="Filter triggers"
					aria-label="Filter triggers"
					data-testid="triggers-filter"
					bind:value={filter}
				/>
			</div>
			<p class="text-sm text-muted-foreground" data-testid="triggers-count">
				{visible.length} of {triggers.length} triggers shown
			</p>
		</div>
		<Card.Content class="px-0">
			<div class="overflow-x-auto">
				<Table.Root data-testid="triggers-table">
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Table</Table.Head>
							<Table.Head>Time</Table.Head>
							<Table.Head>Event</Table.Head>
							<Table.Head>Definer</Table.Head>
							<Table.Head class="text-end">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each visible as t (t.name)}
							<Table.Row data-testid="trigger-row" data-trigger={t.name}>
								<Table.Cell class="font-mono font-medium">{t.name}</Table.Cell>
								<Table.Cell class="font-mono">{t.table}</Table.Cell>
								<Table.Cell><Badge variant="info">{t.timing}</Badge></Table.Cell>
								<Table.Cell><Badge variant="primary">{t.event}</Badge></Table.Cell>
								<Table.Cell>{t.definer}</Table.Cell>
								<Table.Cell>
									<div class="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Edit {t.name}"
											onclick={() => openEdit(t.name)}
										>
											<Pencil />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Export {t.name}"
											onclick={() => openExport(t.name)}
										>
											<Download />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Drop {t.name}"
											onclick={() => {
												dropName = t.name;
												dropOpen = true;
											}}
										>
											<Trash2 />
										</Button>
									</div>
								</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={6} class="py-8 text-center text-muted-foreground">
									{triggers.length === 0 ? 'No triggers found.' : 'No triggers match the filter.'}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</Card.Content>
	</Card.Root>
</div>

<Dialog.Root bind:open={editorOpen}>
	<Dialog.Content class="max-h-[92vh] overflow-y-auto sm:max-w-2xl" data-testid="trigger-editor">
		<Dialog.Header>
			<Dialog.Title>{original ? `Edit trigger ${original}` : 'Add trigger'}</Dialog.Title>
			<Dialog.Description>
				Editing drops and re-creates the trigger; the original is restored if creation fails.
			</Dialog.Description>
		</Dialog.Header>
		<form class="grid gap-4" onsubmit={save}>
			{#if errors.length > 0}
				<Alert.Root variant="destructive" data-testid="trigger-errors">
					<ul class="list-inside list-disc">
						{#each errors as message (message)}<li>{message}</li>{/each}
					</ul>
				</Alert.Root>
			{/if}
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="grid gap-1.5">
					<Label for="trigger-name">Trigger name</Label>
					<Input id="trigger-name" bind:value={def.name} autocomplete="off" />
				</div>
				<div class="grid gap-1.5">
					<Label>Table</Label>
					<SelectField
						label="Table"
						bind:value={def.table}
						options={tables}
						disabled={fixedTable !== null}
						testid="trigger-table"
					/>
				</div>
				<div class="grid gap-1.5">
					<Label>Time</Label>
					<SelectField label="Time" bind:value={def.timing} options={TRIGGER_TIMINGS} />
				</div>
				<div class="grid gap-1.5">
					<Label>Event</Label>
					<SelectField label="Event" bind:value={def.event} options={TRIGGER_EVENTS} />
				</div>
			</div>
			<div class="grid gap-1.5">
				<Label>Definition</Label>
				<SqlEditor
					id="trigger-definition"
					aria-label="Definition"
					minLines={6}
					bind:value={def.definition}
				/>
			</div>
			<div class="grid gap-1.5">
				<Label for="trigger-definer">Definer (user@host)</Label>
				<Input id="trigger-definer" bind:value={def.definer} placeholder="root@localhost" />
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (editorOpen = false)}>Cancel</Button>
				<Button type="submit" disabled={saving} data-testid="trigger-save">
					{saving ? 'Saving...' : 'Save'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
<SqlDialog bind:open={exportOpen} title={exportTitle} sql={exportSql} />
<ConfirmDrop
	bind:open={dropOpen}
	subject="trigger {dropName}"
	busy={dropping}
	onconfirm={confirmDrop}
/>
