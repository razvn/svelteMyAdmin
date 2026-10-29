<script lang="ts">
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Download from '@lucide/svelte/icons/download';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { page } from '$app/state';
	import { refreshAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { matchesFilter } from '#lib/admin/filter.ts';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import ConfirmDrop from '#lib/components/database/confirm-drop.svelte';
	import EventEditor from '#lib/components/database/event-editor.svelte';
	import SqlDialog from '#lib/components/database/sql-dialog.svelte';
	import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { callAction } from '#lib/forms/call-action.ts';
	import type { EventDef } from '#lib/sql/event.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	let { data }: PageProps = $props();

	const blank = (): EventDef => ({
		name: '',
		status: 'ENABLED',
		type: 'ONE TIME',
		executeAt: '',
		intervalValue: '',
		intervalField: 'DAY',
		starts: '',
		ends: '',
		definition: '',
		preserve: false,
		definer: '',
		comment: ''
	});

	const statusVariant = (status: string): BadgeVariant =>
		status === 'ENABLED' ? 'success' : status === 'DISABLED' ? 'destructive' : 'warning';

	let filter = $state('');
	const visible = $derived(
		data.events.filter((e) => matchesFilter(filter, e.name, e.status, e.type, e.definer, e.comment))
	);

	let editorOpen = $state(false);
	let editorDef = $state<EventDef>(blank());
	let editorOriginal = $state<string | null>(null);
	let exportOpen = $state(false);
	let exportTitle = $state('');
	let exportSql = $state('');
	let dropOpen = $state(false);
	let dropName = $state('');
	let dropping = $state(false);
	let toggling = $state(false);

	$effect(() => {
		if (data.highlight) {
			document
				.querySelector('[data-highlighted-event="true"]')
				?.scrollIntoView({ block: 'center' });
		}
	});

	function openAdd() {
		editorDef = blank();
		editorOriginal = null;
		editorOpen = true;
	}

	async function openEdit(name: string) {
		const res = await callAction<{ event: EventDef }>(page.url.pathname, 'get', { name });
		if (!res.ok || !res.data?.event) return void toast.error(res.message ?? t('Event not found.'));
		editorDef = res.data.event;
		editorOriginal = name;
		editorOpen = true;
	}

	async function openExport(name: string) {
		const res = await callAction<{ sql: string }>(page.url.pathname, 'export', { name });
		if (!res.ok || !res.data?.sql) return void toast.error(res.message ?? t('Export failed.'));
		exportTitle = t('Export of event {name}', { name });
		exportSql = res.data.sql;
		exportOpen = true;
	}

	async function confirmDrop() {
		dropping = true;
		const res = await callAction(page.url.pathname, 'drop', { name: dropName });
		dropping = false;
		if (res.ok) {
			toast.success(t('Event {name} has been dropped.', { name: dropName }));
			dropOpen = false;
			await refreshAll();
		} else toast.error(res.message ?? t('Drop failed.'));
	}

	async function toggleScheduler(on: boolean) {
		toggling = true;
		const res = await callAction(page.url.pathname, 'scheduler', { state: on ? 'ON' : 'OFF' });
		toggling = false;
		if (!res.ok) toast.error(res.message ?? t('Changing the event scheduler failed.'));
		await refreshAll();
	}

	async function saved(name: string) {
		toast.success(t('Event {name} has been saved.', { name }));
		await refreshAll();
	}

	function schedule(e: (typeof data.events)[number]): string {
		if (e.type === 'RECURRING')
			return t('every {value} {unit}', {
				value: e.intervalValue ?? '',
				unit: e.intervalField ?? ''
			});
		return e.executeAt ?? '';
	}
</script>

<svelte:head>
	<title>{t('Events')} - {page.params.db} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={CalendarClock}
		title={t('Events')}
		description={t('Scheduled events of {db}.', { db: page.params.db ?? '' })}
	>
		{#snippet actions()}
			<Button onclick={openAdd} data-testid="event-add"><Plus /> {t('Add event')}</Button>
		{/snippet}
	</PageHeader>

	<Card.Root class="gap-0 py-0">
		<div class="flex flex-wrap items-center justify-between gap-3 border-b p-5">
			<div class="flex items-center gap-3" data-testid="scheduler">
				<Switch
					id="scheduler-switch"
					checked={data.scheduler.state === 'ON'}
					disabled={toggling ||
						!data.scheduler.canToggle ||
						(data.scheduler.state !== 'ON' && data.scheduler.state !== 'OFF')}
					aria-label={t('Event scheduler')}
					onCheckedChange={toggleScheduler}
				/>
				<label for="scheduler-switch" class="text-sm">
					{t('Event scheduler:')}
					<Badge
						variant={data.scheduler.state === 'ON' ? 'success' : 'muted'}
						data-testid="scheduler-state"
					>
						{data.scheduler.state ?? t('unknown')}
					</Badge>
				</label>
				{#if !data.scheduler.canToggle}
					<span class="text-xs text-muted-foreground"
						>{t('You cannot change it (needs SUPER).')}</span
					>
				{/if}
			</div>
			<div class="relative w-full max-w-xs">
				<Search class="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					class="ps-8"
					placeholder={t('Filter events')}
					aria-label={t('Filter events')}
					data-testid="events-filter"
					bind:value={filter}
				/>
			</div>
		</div>
		<Card.Content class="px-0">
			<div class="overflow-x-auto">
				<Table.Root data-testid="events-table">
					<Table.Header>
						<Table.Row>
							<Table.Head>{t('Name')}</Table.Head>
							<Table.Head>{t('Status')}</Table.Head>
							<Table.Head>{t('Type')}</Table.Head>
							<Table.Head>{t('Schedule')}</Table.Head>
							<Table.Head>{t('Starts')}</Table.Head>
							<Table.Head>{t('Ends')}</Table.Head>
							<Table.Head>{t('Definer')}</Table.Head>
							<Table.Head class="text-end">{t('Actions')}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each visible as e (e.name)}
							<Table.Row
								data-testid="event-row"
								data-event={e.name}
								data-highlighted-event={data.highlight === e.name}
								class={data.highlight === e.name ? 'bg-primary-soft' : ''}
							>
								<Table.Cell class="font-mono font-medium">{e.name}</Table.Cell>
								<Table.Cell><Badge variant={statusVariant(e.status)}>{e.status}</Badge></Table.Cell>
								<Table.Cell>{e.type}</Table.Cell>
								<Table.Cell class="font-mono text-[13px]">{schedule(e)}</Table.Cell>
								<Table.Cell class="font-mono text-[13px]">{e.starts ?? ''}</Table.Cell>
								<Table.Cell class="font-mono text-[13px]">{e.ends ?? ''}</Table.Cell>
								<Table.Cell>{e.definer}</Table.Cell>
								<Table.Cell>
									<div class="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t('Edit {name}', { name: e.name })}
											onclick={() => openEdit(e.name)}
										>
											<Pencil />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t('Export {name}', { name: e.name })}
											onclick={() => openExport(e.name)}
										>
											<Download />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t('Drop {name}', { name: e.name })}
											onclick={() => {
												dropName = e.name;
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
								<Table.Cell colspan={8} class="py-8 text-center text-muted-foreground">
									{data.events.length === 0
										? t('No events in this database.')
										: t('No events match the filter.')}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</Card.Content>
	</Card.Root>
</div>

<EventEditor
	bind:open={editorOpen}
	bind:def={editorDef}
	original={editorOriginal}
	onsaved={saved}
/>
<SqlDialog bind:open={exportOpen} title={exportTitle} sql={exportSql} />
<ConfirmDrop
	bind:open={dropOpen}
	title={t('Drop event {name}?', { name: dropName })}
	busy={dropping}
	onconfirm={confirmDrop}
/>
