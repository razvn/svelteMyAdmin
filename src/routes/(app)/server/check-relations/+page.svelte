<script lang="ts">
	import { enhance } from '$app/forms';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t, tn } = useI18n();
	let { data, form }: PageProps = $props();

	const status = $derived(data.status);
	const error = $derived(form && 'error' in form ? (form.error as string) : null);
	const created = $derived(
		form && 'created' in form
			? {
					created: form.created as string[],
					db: form.db as string,
					configured: form.configured as boolean
				}
			: null
	);
	let busy = $state(false);

	const configSnippet = $derived(
		created && !created.configured ? `"pmadb": "${created.db}"` : null
	);
</script>

<svelte:head>
	<title>{t('Configuration storage')} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={DatabaseZap}
		title={t('Configuration storage')}
		description={t(
			'phpMyAdmin configuration storage (pmadb): the tables behind bookmarks, relations, history, favorites and more.'
		)}
	/>

	{#if error}
		<Alert variant="destructive" role="alert" data-testid="storage-error">
			<AlertTitle>{t('Could not create the configuration storage')}</AlertTitle>
			<AlertDescription>{error}</AlertDescription>
		</Alert>
	{/if}
	{#if created}
		<Alert variant="success" role="status" data-testid="storage-created">
			<AlertTitle>
				{created.created.length === 0
					? t('Nothing to create')
					: tn('Created {n} table in {db}', 'Created {n} tables in {db}', created.created.length, {
							db: created.db
						})}
			</AlertTitle>
			<AlertDescription>
				{created.created.join(', ')}
				{#if configSnippet}
					<p class="mt-1">
						{t('Set {setting} (and the table names) in the server configuration to use it.', {
							setting: configSnippet
						})}
					</p>
				{/if}
			</AlertDescription>
		</Alert>
	{/if}

	{#if !status.configured}
		<Alert variant="warning" data-testid="storage-unconfigured">
			<AlertTitle>{t('Configuration of pmadb... not OK')}</AlertTitle>
			<AlertDescription>
				{t(
					'General relation features are disabled. Set pmadb and the table names in the server configuration, or create the database {db} and its tables now.',
					{ db: status.pmadb }
				)}
			</AlertDescription>
		</Alert>
	{:else if !status.reachable}
		<Alert variant="warning" data-testid="storage-unreachable">
			<AlertTitle>{t('The database {db} is not reachable', { db: status.pmadb })}</AlertTitle>
			<AlertDescription>
				{t('It does not exist or the control user cannot read it. You can create it below.')}
			</AlertDescription>
		</Alert>
	{/if}

	{#if !status.allWorks}
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Create the storage')}</Card.Title>
				<Card.Description>
					{t("Runs phpMyAdmin's create_tables.sql with your account.")}
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4">
				<form
					method="POST"
					action={status.reachable ? '?/fixTables' : '?/createPmadb'}
					class="flex flex-wrap items-center gap-3"
					use:enhance={() => {
						busy = true;
						return async ({ update }) => {
							await update();
							busy = false;
						};
					}}
				>
					<Button type="submit" disabled={busy} data-testid="create-storage">
						{status.reachable
							? t('Create missing configuration storage tables')
							: t('Create database {db} and its tables', { db: status.pmadb })}
					</Button>
				</form>

				<form
					method="POST"
					action="?/fixCurrent"
					class="flex flex-wrap items-center gap-3"
					use:enhance={() => {
						busy = true;
						return async ({ update }) => {
							await update({ reset: false });
							busy = false;
						};
					}}
				>
					<label class="text-sm" for="fix-db">{t('Create the tables in another database')}</label>
					<NativeSelect id="fix-db" name="db" value={data.currentDb} aria-label={t('Database')}>
						<NativeSelectOption value="">{t('Choose...')}</NativeSelectOption>
						{#each data.databases as db (db)}
							<NativeSelectOption value={db}>{db}</NativeSelectOption>
						{/each}
					</NativeSelect>
					<Button type="submit" variant="outline" disabled={busy} data-testid="create-in-db">
						{t('Create')}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root class="gap-0 py-0">
		<Card.Header class="border-b py-5">
			<Card.Title class="flex items-center gap-3">
				pmadb
				<code class="font-mono text-sm font-normal">{status.configured ? status.pmadb : '-'}</code>
				<Badge
					variant={status.allWorks ? 'success' : status.configured ? 'warning' : 'destructive'}
					data-testid="storage-summary"
				>
					{status.allWorks ? t('All features work') : t('{n} not OK', { n: status.missing })}
				</Badge>
			</Card.Title>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root data-testid="storage-table">
				<Table.Header>
					<Table.Row>
						<Table.Head>{t('Setting')}</Table.Head>
						<Table.Head>{t('Table')}</Table.Head>
						<Table.Head>{t('Enables')}</Table.Head>
						<Table.Head class="text-end">{t('Status')}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each status.features as f (f.key)}
						<Table.Row data-testid="feature-{f.key}">
							<Table.Cell class="font-mono">{f.key}</Table.Cell>
							<Table.Cell class="font-mono">{f.name || '-'}</Table.Cell>
							<Table.Cell class="whitespace-normal">{t(f.enables)}</Table.Cell>
							<Table.Cell class="text-end">
								{#if f.ok}
									<Badge variant="success">{t('OK')}</Badge>
								{:else}
									<Badge variant="destructive">{t('not OK')}</Badge>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
