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
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

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
		triggers.filter((trg) =>
			matchesFilter(filter, trg.name, trg.table, trg.event, trg.timing, trg.definer)
		)
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
		if (!res.ok || !res.data?.trigger)
			return void toast.error(res.message ?? t('Trigger not found.'));
		def = res.data.trigger;
		original = name;
		errors = [];
		editorOpen = true;
	}

	async function openExport(name: string) {
		const res = await callAction<{ sql: string }>(page.url.pathname, 'export', { name });
		if (!res.ok || !res.data?.sql) return void toast.error(res.message ?? t('Export failed.'));
		exportTitle = t('Export of trigger {name}', { name });
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
			toast.success(t('Trigger {name} has been saved.', { name: def.name }));
			await refreshAll();
		} else {
			errors = res.data?.errors ?? [res.message ?? t('Saving the trigger failed.')];
		}
	}

	async function confirmDrop() {
		dropping = true;
		const res = await callAction(page.url.pathname, 'drop', { name: dropName });
		dropping = false;
		if (res.ok) {
			toast.success(t('Trigger {name} has been dropped.', { name: dropName }));
			dropOpen = false;
			await refreshAll();
		} else toast.error(res.message ?? t('Drop failed.'));
	}
</script>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Zap}
		title={t('Triggers')}
		description={fixedTable
			? t('Triggers on {table}.', { table: fixedTable })
			: t('Triggers of {db}.', { db: page.params.db ?? '' })}
	>
		{#snippet actions()}
			<Button onclick={openAdd} data-testid="trigger-add"><Plus /> {t('Add trigger')}</Button>
		{/snippet}
	</PageHeader>

	<Card.Root class="gap-0 py-0">
		<div class="flex flex-wrap items-center justify-between gap-3 border-b p-5">
			<div class="relative w-full max-w-sm">
				<Search class="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					class="ps-8"
					placeholder={t('Filter triggers')}
					aria-label={t('Filter triggers')}
					data-testid="triggers-filter"
					bind:value={filter}
				/>
			</div>
			<p class="text-sm text-muted-foreground" data-testid="triggers-count">
				{t('{shown} of {total} triggers shown', { shown: visible.length, total: triggers.length })}
			</p>
		</div>
		<Card.Content class="px-0">
			<div class="overflow-x-auto">
				<Table.Root data-testid="triggers-table">
					<Table.Header>
						<Table.Row>
							<Table.Head>{t('Name')}</Table.Head>
							<Table.Head>{t('Table')}</Table.Head>
							<Table.Head>{t('Time')}</Table.Head>
							<Table.Head>{t('Event')}</Table.Head>
							<Table.Head>{t('Definer')}</Table.Head>
							<Table.Head class="text-end">{t('Actions')}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each visible as trg (trg.name)}
							<Table.Row data-testid="trigger-row" data-trigger={trg.name}>
								<Table.Cell class="font-mono font-medium">{trg.name}</Table.Cell>
								<Table.Cell class="font-mono">{trg.table}</Table.Cell>
								<Table.Cell><Badge variant="info">{trg.timing}</Badge></Table.Cell>
								<Table.Cell><Badge variant="primary">{trg.event}</Badge></Table.Cell>
								<Table.Cell>{trg.definer}</Table.Cell>
								<Table.Cell>
									<div class="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t('Edit {name}', { name: trg.name })}
											onclick={() => openEdit(trg.name)}
										>
											<Pencil />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t('Export {name}', { name: trg.name })}
											onclick={() => openExport(trg.name)}
										>
											<Download />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t('Drop {name}', { name: trg.name })}
											onclick={() => {
												dropName = trg.name;
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
									{triggers.length === 0
										? t('No triggers found.')
										: t('No triggers match the filter.')}
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
			<Dialog.Title
				>{original ? t('Edit trigger {name}', { name: original }) : t('Add trigger')}</Dialog.Title
			>
			<Dialog.Description>
				{t('Editing drops and re-creates the trigger; the original is restored if creation fails.')}
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
					<Label for="trigger-name">{t('Trigger name')}</Label>
					<Input id="trigger-name" bind:value={def.name} autocomplete="off" />
				</div>
				<div class="grid gap-1.5">
					<Label>{t('Table')}</Label>
					<SelectField
						label={t('Table')}
						bind:value={def.table}
						options={tables}
						disabled={fixedTable !== null}
						testid="trigger-table"
					/>
				</div>
				<div class="grid gap-1.5">
					<Label>{t('Time')}</Label>
					<SelectField label={t('Time')} bind:value={def.timing} options={TRIGGER_TIMINGS} />
				</div>
				<div class="grid gap-1.5">
					<Label>{t('Event')}</Label>
					<SelectField label={t('Event')} bind:value={def.event} options={TRIGGER_EVENTS} />
				</div>
			</div>
			<div class="grid gap-1.5">
				<Label>{t('Definition')}</Label>
				<SqlEditor
					id="trigger-definition"
					aria-label={t('Definition')}
					minLines={6}
					bind:value={def.definition}
				/>
			</div>
			<div class="grid gap-1.5">
				<Label for="trigger-definer">{t('Definer (user@host)')}</Label>
				<Input id="trigger-definer" bind:value={def.definer} placeholder="root@localhost" />
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (editorOpen = false)}
					>{t('Cancel')}</Button
				>
				<Button type="submit" disabled={saving} data-testid="trigger-save">
					{saving ? t('Saving...') : t('Save')}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
<SqlDialog bind:open={exportOpen} title={exportTitle} sql={exportSql} />
<ConfirmDrop
	bind:open={dropOpen}
	title={t('Drop trigger {name}?', { name: dropName })}
	busy={dropping}
	onconfirm={confirmDrop}
/>
