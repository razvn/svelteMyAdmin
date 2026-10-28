<script lang="ts">
	import { resolve } from '$app/paths';
	import Cpu from '@lucide/svelte/icons/cpu';
	import { bare } from '#lib/nav/paths.ts';
	import { engineSupportVariant, yesNoVariant as yesNo } from '#lib/admin/badges.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Storage engines - svelteMyAdmin</title>
</svelte:head>

<PageHeader
	icon={Cpu}
	title="Storage engines"
	description="Engines available on this server and the features they support."
/>

<Card.Root class="gap-0 py-0">
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
					class={engine.support === 'DEFAULT' ? 'bg-primary-soft/60 hover:bg-primary-soft' : ''}
				>
					<Table.Cell class="font-medium">
						<a
							class="font-semibold text-primary underline-offset-4 hover:underline"
							href={resolve(bare(`/server/engines/${encodeURIComponent(engine.name)}`))}
						>
							{engine.name}
						</a>
					</Table.Cell>
					<Table.Cell>
						<Badge variant={engineSupportVariant(engine.support)}>{engine.support}</Badge>
					</Table.Cell>
					<Table.Cell class="min-w-64 whitespace-normal text-muted-foreground">
						{engine.comment}
					</Table.Cell>
					<Table.Cell
						><Badge variant={yesNo(engine.transactions)}>{engine.transactions}</Badge></Table.Cell
					>
					<Table.Cell><Badge variant={yesNo(engine.xa)}>{engine.xa}</Badge></Table.Cell>
					<Table.Cell
						><Badge variant={yesNo(engine.savepoints)}>{engine.savepoints}</Badge></Table.Cell
					>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</Card.Root>
