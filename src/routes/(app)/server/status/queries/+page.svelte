<script lang="ts">
	import Activity from '@lucide/svelte/icons/activity';
	import Gauge from '@lucide/svelte/icons/gauge';
	import Timer from '@lucide/svelte/icons/timer';
	import { formatNumber, formatSi } from '#lib/format.ts';
	import { donutSlices } from '#lib/admin/queries.ts';
	import StatCard from '#lib/components/app-shell/stat-card.svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const stats = $derived(data.stats);
	const slices = $derived(donutSlices(stats.chart));
	// theme chart tokens (--chart-1 .. --chart-5) cycled
	const fill = (i: number) => `var(--chart-${(i % 5) + 1})`;
	const percent = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}%`;
</script>

<svelte:head>
	<title>Query statistics - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<h2 class="text-lg font-semibold" data-testid="questions">
		Questions since startup: {formatNumber(stats.total)}
	</h2>

	<section aria-label="Query rates" class="grid gap-4 sm:grid-cols-3">
		<StatCard
			label="ø per hour"
			value={formatNumber(stats.perHour)}
			icon={Activity}
			tone="primary"
		/>
		<StatCard label="ø per minute" value={formatNumber(stats.perMinute)} icon={Timer} tone="info" />
		<StatCard
			label="ø per second"
			value={stats.perSecond >= 1 ? formatNumber(stats.perSecond) : '< 1'}
			icon={Gauge}
			tone="success"
		/>
	</section>

	<div class="grid items-start gap-6 lg:grid-cols-2">
		<Card.Root class="gap-0 py-0">
			<Card.Content class="px-0">
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
								<Table.Head
									scope="row"
									class="h-auto px-4 py-3 text-sm font-normal text-foreground first:ps-5"
								>
									{q.name}
								</Table.Head>
								<Table.Cell class="text-end tabular-nums">
									{formatSi(q.value, 5, 0, true)}
								</Table.Cell>
								<Table.Cell class="text-end tabular-nums">
									{formatSi(q.perHour, 4, 1, true)}
								</Table.Cell>
								<Table.Cell class="text-end tabular-nums">
									{formatSi(q.percentage, 0, 2)}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		{#if slices.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title>Top statements</Card.Title>
					<Card.Description>Share of the most frequent statement types.</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-wrap items-center justify-center gap-8">
					<svg
						viewBox="-1.05 -1.05 2.1 2.1"
						class="size-52 shrink-0"
						role="img"
						aria-label="Query types donut chart"
						data-testid="queries-chart"
					>
						{#each slices as s, i (s.name)}
							<path d={s.d} fill={fill(i)} stroke="var(--card)" stroke-width="0.025">
								<title>{s.name}: {s.value} ({percent(s.percent)})</title>
							</path>
						{/each}
					</svg>
					<ul class="flex min-w-40 flex-col gap-2.5 text-sm" aria-label="Legend">
						{#each slices as s, i (s.name)}
							<li class="flex items-center gap-2.5">
								<span
									aria-hidden="true"
									class="size-2.5 shrink-0 rounded-full"
									style:background={fill(i)}
								></span>
								<span class="min-w-0 truncate">{s.name}</span>
								<span class="ms-auto ps-4 text-muted-foreground tabular-nums">
									{percent(s.percent)}
								</span>
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/if}
	</div>
</div>
