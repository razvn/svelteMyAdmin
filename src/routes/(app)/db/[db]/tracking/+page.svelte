<script lang="ts">
	import { enhance } from '$app/forms';
	import Eye from '@lucide/svelte/icons/eye';
	import FileText from '@lucide/svelte/icons/file-text';
	import History from '@lucide/svelte/icons/history';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import VersionForm from '#lib/components/tracking/version-form.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	let { data, form }: PageProps = $props();

	const tableBase = (tbl: string) =>
		`/db/${encodeURIComponent(data.db)}/table/${encodeURIComponent(tbl)}/tracking`;

	let selectedTracked = $state<string[]>([]);
	let selectedUntracked = $state<string[]>([]);
	let showVersionForm = $state(false);

	const toggle = (list: string[], name: string, on: boolean) =>
		on ? [...list.filter((n) => n !== name), name] : list.filter((n) => n !== name);

	const message = $derived(form && 'message' in form ? String(form.message) : '');
	const error = $derived(form && 'error' in form ? String(form.error) : '');
</script>

<svelte:head><title>{t('Tracking')} - {data.db}</title></svelte:head>

<div class="flex flex-col gap-6" data-testid="db-tracking">
	<PageHeader
		icon={History}
		title={t('Tracking')}
		description={t('Version the structure and data changes of the tables of {db}.', {
			db: data.db
		})}
	/>

	{#if message}
		<Alert.Root role="status" data-testid="tracking-message"
			><Alert.Title>{message}</Alert.Title></Alert.Root
		>
	{/if}
	{#if error}
		<Alert.Root variant="destructive" role="alert"><Alert.Title>{error}</Alert.Title></Alert.Root>
	{/if}

	{#if !data.available}
		<Alert.Root role="status" data-testid="tracking-disabled">
			<Alert.Title>{t('Tracking is not available')}</Alert.Title>
			<Alert.Description>
				{t('The tracking table of the configuration storage is not configured or not reachable.')}
			</Alert.Description>
		</Alert.Root>
	{:else}
		{#if data.tracked.length > 0}
			<Card.Root>
				<Card.Header><Card.Title>{t('Tracked tables')}</Card.Title></Card.Header>
				<Card.Content>
					<form method="POST" action="?/deleteTracking" use:enhance class="flex flex-col gap-3">
						{#each selectedTracked as tbl (tbl)}
							<input type="hidden" name="table" value={tbl} />
						{/each}
						<Table.Root data-testid="tracked-tables">
							<Table.Header>
								<Table.Row>
									<Table.Head class="w-8"></Table.Head>
									<Table.Head>{t('Table')}</Table.Head>
									<Table.Head>{t('Last version')}</Table.Head>
									<Table.Head>{t('Created')}</Table.Head>
									<Table.Head>{t('Updated')}</Table.Head>
									<Table.Head>{t('Status')}</Table.Head>
									<Table.Head>{t('Show')}</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each data.tracked as v (v.table)}
									<Table.Row data-testid="tracked-{v.table}">
										<Table.Cell>
											<Checkbox
												aria-label={t('Select {name}', { name: v.table })}
												checked={selectedTracked.includes(v.table)}
												onCheckedChange={(c) =>
													(selectedTracked = toggle(selectedTracked, v.table, c === true))}
											/>
										</Table.Cell>
										<Table.Cell class="font-mono font-medium">{v.table}</Table.Cell>
										<Table.Cell>{v.version}</Table.Cell>
										<Table.Cell>{v.created}</Table.Cell>
										<Table.Cell>{v.updated}</Table.Cell>
										<Table.Cell>
											<Badge variant={v.active ? 'default' : 'secondary'}>
												{v.active ? t('active') : t('not active')}
											</Badge>
										</Table.Cell>
										<Table.Cell class="flex gap-1">
											<Button variant="ghost" size="sm" href={tableBase(v.table)}>
												<History />
												{t('Versions')}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												href="{tableBase(v.table)}?report=1&version={v.version}"
											>
												<FileText />
												{t('Report')}
											</Button>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
						<div>
							<Button
								type="submit"
								variant="destructive"
								disabled={!hydration.ready || selectedTracked.length === 0}
							>
								<Trash2 />
								{t('Delete tracking')}
							</Button>
						</div>
					</form>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if data.untracked.length > 0}
			<Card.Root>
				<Card.Header><Card.Title>{t('Untracked tables')}</Card.Title></Card.Header>
				<Card.Content class="flex flex-col gap-3">
					<Table.Root data-testid="untracked-tables">
						<Table.Header>
							<Table.Row>
								<Table.Head class="w-8"></Table.Head>
								<Table.Head>{t('Table')}</Table.Head>
								<Table.Head>{t('Action')}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.untracked as tbl (tbl)}
								<Table.Row data-testid="untracked-{tbl}">
									<Table.Cell>
										<Checkbox
											aria-label={t('Select {name}', { name: tbl })}
											checked={selectedUntracked.includes(tbl)}
											onCheckedChange={(c) =>
												(selectedUntracked = toggle(selectedUntracked, tbl, c === true))}
										/>
									</Table.Cell>
									<Table.Cell class="font-mono font-medium">{tbl}</Table.Cell>
									<Table.Cell>
										<Button variant="ghost" size="sm" href={tableBase(tbl)}>
											<Eye />
											{t('Track table')}
										</Button>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
					<div>
						<Button
							type="button"
							variant="outline"
							disabled={selectedUntracked.length === 0}
							onclick={() => (showVersionForm = true)}
						>
							<Eye />
							{t('Track selected tables')}
						</Button>
					</div>
					{#if showVersionForm && selectedUntracked.length > 0}
						<VersionForm
							action="?/track"
							defaults={data.defaults}
							version={1}
							hidden={selectedUntracked.map((tbl) => ({ name: 'table', value: tbl }))}
							submitLabel={t('Create version for {n} table(s)', { n: selectedUntracked.length })}
						/>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		{#if data.tracked.length === 0 && data.untracked.length === 0}
			<p class="text-sm text-muted-foreground">{t('No tables found in database.')}</p>
		{/if}

		{#if data.log.length > 0}
			<Card.Root>
				<Card.Header><Card.Title>{t('Database log')}</Card.Title></Card.Header>
				<Card.Content>
					<pre class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{data.log
							.map((e) => `# ${e.date} ${e.username}\n${e.statement}`)
							.join('\n')}</pre>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>
