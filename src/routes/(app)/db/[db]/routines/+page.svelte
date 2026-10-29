<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Play from '@lucide/svelte/icons/play';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Terminal from '@lucide/svelte/icons/square-function';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { page } from '$app/state';
	import { refreshAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { matchesFilter } from '#lib/admin/filter.ts';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import ConfirmDrop from '#lib/components/database/confirm-drop.svelte';
	import RoutineEditor from '#lib/components/database/routine-editor.svelte';
	import RoutineExecute from '#lib/components/database/routine-execute.svelte';
	import SqlDialog from '#lib/components/database/sql-dialog.svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { callAction } from '#lib/forms/call-action.ts';
	import type { RoutineDef } from '#lib/sql/routine.ts';
	import type { RoutineType } from '#lib/sql/routine-types.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	let { data }: PageProps = $props();

	const blank = (): RoutineDef => ({
		type: 'PROCEDURE',
		name: '',
		definer: '',
		params: [],
		returns: { type: 'INT', length: '', opts: '' },
		definition: '',
		deterministic: false,
		securityType: '',
		sqlDataAccess: '',
		comment: ''
	});

	let filter = $state('');
	const visible = $derived(
		data.routines.filter((r) =>
			matchesFilter(filter, r.name, r.type, r.definer, r.comment, r.returns)
		)
	);

	let editorOpen = $state(false);
	let editorDef = $state<RoutineDef>(blank());
	let editorOriginal = $state<{ type: RoutineType; name: string } | null>(null);

	let executeOpen = $state(false);
	let executeKey = $state(0);
	let executeDef = $state<RoutineDef>(blank());

	let exportOpen = $state(false);
	let exportTitle = $state('');
	let exportSql = $state('');

	let dropOpen = $state(false);
	let dropTarget = $state<{ type: RoutineType; name: string } | null>(null);
	let dropping = $state(false);

	const isHighlighted = (type: string, name: string) =>
		data.highlight.item === name && (data.highlight.type === null || data.highlight.type === type);

	$effect(() => {
		if (data.highlight.item) {
			document
				.querySelector('[data-highlighted-routine="true"]')
				?.scrollIntoView({ block: 'center' });
		}
	});

	function openAdd() {
		editorDef = blank();
		editorOriginal = null;
		editorOpen = true;
	}

	async function load(type: RoutineType, name: string): Promise<RoutineDef | null> {
		const res = await callAction<{ routine: RoutineDef }>(page.url.pathname, 'get', { type, name });
		if (!res.ok || !res.data?.routine) {
			toast.error(res.message ?? t('The routine could not be loaded.'));
			return null;
		}
		return res.data.routine;
	}

	async function openEdit(type: RoutineType, name: string) {
		const def = await load(type, name);
		if (!def) return;
		editorDef = def;
		editorOriginal = { type, name };
		editorOpen = true;
	}

	async function openExecute(type: RoutineType, name: string) {
		const def = await load(type, name);
		if (!def) return;
		executeDef = def;
		executeKey++;
		executeOpen = true;
	}

	async function openExport(type: RoutineType, name: string) {
		const res = await callAction<{ sql: string }>(page.url.pathname, 'export', { type, name });
		if (!res.ok || !res.data?.sql) {
			toast.error(res.message ?? t('The routine could not be exported.'));
			return;
		}
		exportTitle =
			type === 'PROCEDURE'
				? t('Export of procedure {name}', { name })
				: t('Export of function {name}', { name });
		exportSql = res.data.sql;
		exportOpen = true;
	}

	async function confirmDrop() {
		if (!dropTarget) return;
		dropping = true;
		const res = await callAction(page.url.pathname, 'drop', dropTarget);
		dropping = false;
		if (res.ok) {
			toast.success(t('Routine {name} has been dropped.', { name: dropTarget.name }));
			dropOpen = false;
			await refreshAll();
		} else {
			toast.error(res.message ?? t('Drop failed.'));
		}
	}

	async function saved(name: string) {
		toast.success(t('Routine {name} has been saved.', { name }));
		await refreshAll();
	}
</script>

<svelte:head>
	<title>{t('Routines')} - {page.params.db} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Terminal}
		title={t('Routines')}
		description={t('Stored procedures and functions of {db}.', { db: page.params.db ?? '' })}
	>
		{#snippet actions()}
			<Button onclick={openAdd} data-testid="routine-add"><Plus /> {t('Add routine')}</Button>
		{/snippet}
	</PageHeader>

	<Card.Root class="gap-0 py-0">
		<div class="flex flex-wrap items-center justify-between gap-3 border-b p-5">
			<div class="relative w-full max-w-sm">
				<Search class="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					class="ps-8"
					placeholder={t('Filter routines')}
					aria-label={t('Filter routines')}
					data-testid="routines-filter"
					bind:value={filter}
				/>
			</div>
			<p class="text-sm text-muted-foreground" data-testid="routines-count">
				{t('{shown} of {total} routines shown', { shown: visible.length, total: data.routines.length })}
			</p>
		</div>
		<Card.Content class="px-0">
			<div class="overflow-x-auto">
				<Table.Root data-testid="routines-table">
					<Table.Header>
						<Table.Row>
							<Table.Head>{t('Name')}</Table.Head>
							<Table.Head>{t('Type')}</Table.Head>
							<Table.Head>{t('Returns')}</Table.Head>
							<Table.Head>{t('Definer')}</Table.Head>
							<Table.Head>{t('Security')}</Table.Head>
							<Table.Head>{t('Comment')}</Table.Head>
							<Table.Head class="text-end">{t('Actions')}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each visible as r (r.type + r.name)}
							<Table.Row
								data-testid="routine-row"
								data-routine={r.name}
								data-highlighted-routine={isHighlighted(r.type, r.name)}
								class={isHighlighted(r.type, r.name) ? 'bg-primary-soft' : ''}
							>
								<Table.Cell class="font-mono font-medium">{r.name}</Table.Cell>
								<Table.Cell>
									<Badge variant={r.type === 'PROCEDURE' ? 'primary' : 'info'}>{r.type}</Badge>
								</Table.Cell>
								<Table.Cell class="font-mono text-[13px]">{r.returns}</Table.Cell>
								<Table.Cell>{r.definer}</Table.Cell>
								<Table.Cell>{r.securityType}</Table.Cell>
								<Table.Cell class="max-w-64 whitespace-normal text-muted-foreground">
									{r.comment}
								</Table.Cell>
								<Table.Cell>
									<div class="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t('Edit {name}', { name: r.name })}
											onclick={() => openEdit(r.type, r.name)}
										>
											<Pencil />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t('Execute {name}', { name: r.name })}
											onclick={() => openExecute(r.type, r.name)}
										>
											<Play />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t('Export {name}', { name: r.name })}
											onclick={() => openExport(r.type, r.name)}
										>
											<Download />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t('Drop {name}', { name: r.name })}
											onclick={() => {
												dropTarget = { type: r.type, name: r.name };
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
								<Table.Cell colspan={7} class="py-8 text-center text-muted-foreground">
									{data.routines.length === 0
										? t('No routines in this database.')
										: t('No routines match the filter.')}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</Card.Content>
	</Card.Root>
</div>

<RoutineEditor
	bind:open={editorOpen}
	bind:def={editorDef}
	original={editorOriginal}
	onsaved={saved}
/>
{#key executeKey}
	<RoutineExecute bind:open={executeOpen} routine={executeDef} />
{/key}
<SqlDialog bind:open={exportOpen} title={exportTitle} sql={exportSql} />
<ConfirmDrop
	bind:open={dropOpen}
	title={dropTarget?.type === 'PROCEDURE'
		? t('Drop procedure {name}?', { name: dropTarget.name })
		: dropTarget?.type === 'FUNCTION'
			? t('Drop function {name}?', { name: dropTarget.name })
			: t('Drop routine {name}?', { name: dropTarget?.name ?? '' })}
	busy={dropping}
	onconfirm={confirmDrop}
/>
