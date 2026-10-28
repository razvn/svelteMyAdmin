<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Cpu from '@lucide/svelte/icons/cpu';
	import { bare } from '#lib/nav/paths.ts';
	import { engineSupportVariant } from '#lib/admin/badges.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.engine.name} - Storage engines - svelteMyAdmin</title>
</svelte:head>

<a
	class="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
	href={resolve(bare('/server/engines'))}
>
	<ArrowLeft class="size-4" />
	All storage engines
</a>

<h1 class="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
	<Cpu class="size-5 text-muted-foreground" />
	{data.engine.name}
	<Badge variant={engineSupportVariant(data.engine.support)}>{data.engine.support}</Badge>
</h1>
<p class="text-muted-foreground">{data.engine.comment}</p>

<Card.Root>
	<Card.Header>
		<Card.Title>Variables</Card.Title>
		<Card.Description>Global variables of this engine.</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if data.variables.length > 0}
			<div class="overflow-x-auto">
				<Table.Root data-testid="engine-variables">
					<Table.Header>
						<Table.Row>
							<Table.Head>Variable</Table.Head>
							<Table.Head class="text-end">Value</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.variables as variable (variable.name)}
							<Table.Row>
								<Table.Cell class="font-medium">{variable.name}</Table.Cell>
								<Table.Cell class="text-end font-mono">{variable.value}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{:else}
			<p class="text-sm text-muted-foreground">No variables are known for this engine.</p>
		{/if}
	</Card.Content>
</Card.Root>

{#if data.innodbStatus !== null}
	<Card.Root>
		<Card.Header>
			<Card.Title>InnoDB status</Card.Title>
			<Card.Description>Output of SHOW ENGINE INNODB STATUS.</Card.Description>
		</Card.Header>
		<Card.Content>
			<ScrollArea class="h-96 rounded-md border">
				<pre
					class="p-3 font-mono text-xs whitespace-pre"
					data-testid="innodb-status">{data.innodbStatus}</pre>
			</ScrollArea>
		</Card.Content>
	</Card.Root>
{/if}
