<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Cpu from '@lucide/svelte/icons/cpu';
	import { bare } from '#lib/nav/paths.ts';
	import { engineSupportVariant } from '#lib/admin/badges.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.engine.name} - Storage engines - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<a
		class="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
		href={resolve(bare('/server/engines'))}
	>
		<ArrowLeft class="size-4" />
		All storage engines
	</a>

	<PageHeader icon={Cpu} title={data.engine.name} description={data.engine.comment}>
		{#snippet actions()}
			<Badge variant={engineSupportVariant(data.engine.support)}>{data.engine.support}</Badge>
		{/snippet}
	</PageHeader>

	<Card.Root class="gap-0 py-0">
		<Card.Header class="border-b py-5">
			<Card.Title>Variables</Card.Title>
			<Card.Description>Global variables of this engine.</Card.Description>
		</Card.Header>
		<Card.Content class="px-0">
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
									<Table.Cell class="text-end font-mono text-[13px]">{variable.value}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{:else}
				<p class="px-6 py-5 text-sm text-muted-foreground">
					No variables are known for this engine.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if data.innodbStatus !== null}
		<Card.Root class="gap-0 py-0">
			<Card.Header class="border-b py-5">
				<Card.Title>InnoDB status</Card.Title>
				<Card.Description>Output of SHOW ENGINE INNODB STATUS.</Card.Description>
			</Card.Header>
			<Card.Content class="p-5">
				<ScrollArea class="h-96 rounded-lg border bg-muted">
					<pre
						class="p-3 font-mono text-xs whitespace-pre"
						data-testid="innodb-status">{data.innodbStatus}</pre>
				</ScrollArea>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
