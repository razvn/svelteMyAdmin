<script lang="ts">
	import { formatNumber } from '#lib/admin/format.ts';
	import { pieSlices } from '#lib/admin/queries.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const stats = $derived(data.stats);
	const slices = $derived(pieSlices(stats.chart));
	// theme chart tokens (--chart-1 .. --chart-5) cycled
	const fill = (i: number) => `var(--chart-${(i % 5) + 1})`;
</script>

<svelte:head>
	<title>Query statistics - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-4">
	<h1 class="text-lg font-semibold" data-testid="questions">
		Questions since startup: {formatNumber(stats.total, 0)}
	</h1>
	<ul class="list-disc pl-6 text-sm">
		<li>ø per hour: {formatNumber(stats.perHour, 0)}</li>
		<li>ø per minute: {formatNumber(stats.perMinute, 0)}</li>
		{#if stats.perSecond >= 1}
			<li>ø per second: {formatNumber(stats.perSecond, 0)}</li>
		{/if}
	</ul>

	<div class="grid gap-4 lg:grid-cols-2">
		<Table.Root data-testid="queries-table">
			<Table.Header>
				<Table.Row>
					<Table.Head>Statements</Table.Head>
					<Table.Head class="text-end">#</Table.Head>
					<Table.Head class="text-end">ø per hour</Table.Head>
					<Table.Head class="text-end">%</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each stats.queries as q (q.key)}
					<Table.Row>
						<Table.Head scope="row" class="font-normal">{q.name}</Table.Head>
						<Table.Cell class="text-end font-mono">{formatNumber(q.value, 5, 0, true)}</Table.Cell>
						<Table.Cell class="text-end font-mono">{formatNumber(q.perHour, 4, 1, true)}</Table.Cell
						>
						<Table.Cell class="text-end font-mono">{formatNumber(q.percentage, 0, 2)}</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>

		{#if slices.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title>Top statements</Card.Title>
				</Card.Header>
				<Card.Content class="flex flex-wrap items-center gap-6">
					<svg
						viewBox="-1.05 -1.05 2.1 2.1"
						class="size-48"
						role="img"
						aria-label="Query types pie chart"
						data-testid="queries-chart"
					>
						{#each slices as s, i (s.name)}
							<path d={s.d} fill={fill(i)} stroke="var(--background)" stroke-width="0.01">
								<title>{s.name}: {s.value}</title>
							</path>
						{/each}
					</svg>
					<ul class="flex flex-col gap-1 text-sm">
						{#each slices as s, i (s.name)}
							<li class="flex items-center gap-2">
								<span class="inline-block size-3 rounded-sm" style:background={fill(i)}></span>
								{s.name}
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/if}
	</div>
</div>
