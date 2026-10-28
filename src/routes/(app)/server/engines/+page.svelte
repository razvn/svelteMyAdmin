<script lang="ts">
	import { resolve } from '$app/paths';
	import Cpu from '@lucide/svelte/icons/cpu';
	import { bare } from '#lib/nav/paths.ts';
	import { engineSupportVariant } from '#lib/admin/badges.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Storage engines - svelteMyAdmin</title>
</svelte:head>

<h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight">
	<Cpu class="size-5 text-muted-foreground" />
	Storage engines
</h1>

<div class="overflow-x-auto">
	<Table.Root data-testid="engines-table">
		<Table.Header>
			<Table.Row>
				<Table.Head>Storage engine</Table.Head>
				<Table.Head>Support</Table.Head>
				<Table.Head>Description</Table.Head>
				<Table.Head>Transactions</Table.Head>
				<Table.Head>XA</Table.Head>
				<Table.Head>Savepoints</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.engines as engine (engine.name)}
				<Table.Row
					data-testid="engine-row"
					data-engine={engine.name}
					class={engine.support === 'DEFAULT' ? 'bg-muted' : ''}
				>
					<Table.Cell class="font-medium">
						<a
							class="text-primary underline-offset-4 hover:underline"
							href={resolve(bare(`/server/engines/${encodeURIComponent(engine.name)}`))}
						>
							{engine.name}
						</a>
					</Table.Cell>
					<Table.Cell>
						<Badge variant={engineSupportVariant(engine.support)}>{engine.support}</Badge>
					</Table.Cell>
					<Table.Cell class="whitespace-normal">{engine.comment}</Table.Cell>
					<Table.Cell>{engine.transactions}</Table.Cell>
					<Table.Cell>{engine.xa}</Table.Cell>
					<Table.Cell>{engine.savepoints}</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
