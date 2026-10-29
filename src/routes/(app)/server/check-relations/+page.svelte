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
	import type { PageProps } from './$types';

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
	<title>Configuration storage - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={DatabaseZap}
		title="Configuration storage"
		description="phpMyAdmin configuration storage (pmadb): the tables behind bookmarks, relations, history, favorites and more."
	/>

	{#if error}
		<Alert variant="destructive" role="alert" data-testid="storage-error">
			<AlertTitle>Could not create the configuration storage</AlertTitle>
			<AlertDescription>{error}</AlertDescription>
		</Alert>
	{/if}
	{#if created}
		<Alert variant="success" role="status" data-testid="storage-created">
			<AlertTitle>
				{created.created.length === 0
					? 'Nothing to create'
					: `Created ${created.created.length} table${created.created.length === 1 ? '' : 's'} in ${created.db}`}
			</AlertTitle>
			<AlertDescription>
				{created.created.join(', ')}
				{#if configSnippet}
					<p class="mt-1">
						Set <code>{configSnippet}</code> (and the table names) in the server configuration to use
						it.
					</p>
				{/if}
			</AlertDescription>
		</Alert>
	{/if}

	{#if !status.configured}
		<Alert variant="warning" data-testid="storage-unconfigured">
			<AlertTitle>Configuration of pmadb... not OK</AlertTitle>
			<AlertDescription>
				General relation features are disabled. Set <code>pmadb</code> and the table names in the
				server configuration, or create the database <code>{status.pmadb}</code> and its tables now.
			</AlertDescription>
		</Alert>
	{:else if !status.reachable}
		<Alert variant="warning" data-testid="storage-unreachable">
			<AlertTitle>The database <code>{status.pmadb}</code> is not reachable</AlertTitle>
			<AlertDescription>
				It does not exist or the control user cannot read it. You can create it below.
			</AlertDescription>
		</Alert>
	{/if}

	{#if !status.allWorks}
		<Card.Root>
			<Card.Header>
				<Card.Title>Create the storage</Card.Title>
				<Card.Description>
					Runs phpMyAdmin's <code>create_tables.sql</code> with your account.
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
							? 'Create missing configuration storage tables'
							: `Create database ${status.pmadb} and its tables`}
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
					<label class="text-sm" for="fix-db">Create the tables in another database</label>
					<NativeSelect id="fix-db" name="db" value={data.currentDb} aria-label="Database">
						<NativeSelectOption value="">Choose...</NativeSelectOption>
						{#each data.databases as db (db)}
							<NativeSelectOption value={db}>{db}</NativeSelectOption>
						{/each}
					</NativeSelect>
					<Button type="submit" variant="outline" disabled={busy} data-testid="create-in-db">
						Create
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
					{status.allWorks ? 'All features work' : `${status.missing} not OK`}
				</Badge>
			</Card.Title>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root data-testid="storage-table">
				<Table.Header>
					<Table.Row>
						<Table.Head>Setting</Table.Head>
						<Table.Head>Table</Table.Head>
						<Table.Head>Enables</Table.Head>
						<Table.Head class="text-end">Status</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each status.features as f (f.key)}
						<Table.Row data-testid="feature-{f.key}">
							<Table.Cell class="font-mono">{f.key}</Table.Cell>
							<Table.Cell class="font-mono">{f.name || '-'}</Table.Cell>
							<Table.Cell class="whitespace-normal">{f.enables}</Table.Cell>
							<Table.Cell class="text-end">
								{#if f.ok}
									<Badge variant="success">OK</Badge>
								{:else}
									<Badge variant="destructive">not OK</Badge>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
