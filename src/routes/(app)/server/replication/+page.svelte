<script lang="ts">
	import Network from '@lucide/svelte/icons/network';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const r = $derived(data.replication);
</script>

{#snippet kv(row: Record<string, string>)}
	<Table.Root>
		<Table.Body>
			{#each Object.entries(row) as [k, v] (k)}
				<Table.Row>
					<Table.Cell class="w-64 font-medium text-muted-foreground">{k}</Table.Cell>
					<Table.Cell class="font-mono text-[13px] break-all whitespace-normal">{v}</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/snippet}

<svelte:head>
	<title>Replication - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Network}
		title="Replication"
		description="Primary and replica status as reported by the server."
	/>

	{#if r.errors.length > 0}
		<Alert.Root variant="destructive" data-testid="replication-errors">
			<Alert.Title>Replication status could not be read</Alert.Title>
			<Alert.Description>
				{#each r.errors as e (e)}<span class="block">{e}</span>{/each}
			</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root data-testid="primary-status">
		<Card.Header>
			<Card.Title>Primary replication</Card.Title>
			<Card.Description><code>{r.statements.primary}</code></Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col gap-4">
			{#if r.primary}
				<p class="text-sm">
					<Badge variant="success" class="me-2">Enabled</Badge>This server is configured as primary
					in a replication process.
				</p>
				{@render kv(r.primary)}
				<h2 class="font-semibold">Connected replicas</h2>
				{#if r.replicaHosts.length > 0}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								{#each Object.keys(r.replicaHosts[0]) as c (c)}
									<Table.Head>{c}</Table.Head>
								{/each}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.replicaHosts as h, i (i)}
								<Table.Row>
									{#each Object.values(h) as v, j (j)}
										<Table.Cell class="font-mono">{v}</Table.Cell>
									{/each}
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{:else}
					<p class="text-sm text-muted-foreground">No replicas are connected.</p>
				{/if}
			{:else}
				<p class="text-sm text-muted-foreground">
					This server is not configured as primary in a replication process (binary logging is
					disabled or not available to this user).
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root data-testid="replica-status">
		<Card.Header>
			<Card.Title>Replica replication</Card.Title>
			<Card.Description><code>{r.statements.replica}</code></Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col gap-4">
			{#if r.replicas.length > 0}
				<p class="text-sm">
					<Badge variant="success" class="me-2">Enabled</Badge>This server is configured as replica
					in a replication process.
				</p>
				{#each r.replicas as rep, i (i)}
					{@render kv(rep)}
				{/each}
			{:else}
				<p class="text-sm text-muted-foreground">
					This server is not configured as replica in a replication process.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
