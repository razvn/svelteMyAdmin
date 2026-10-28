<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import { formatBytes, formatNumber, timespanFormat } from '#lib/admin/format.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const s = $derived(data.summary);
	const hours = $derived(s.uptime > 0 ? s.uptime / 3600 : 1);
	const startedAt = $derived(new Date(s.startedAt).toLocaleString());
	const received = $derived(s.bytesReceived);
	const sent = $derived(s.bytesSent);
	const perHour = (n: number) => formatBytes(n / hours);
	const perHourNum = (n: number) => formatNumber(n / hours, 4, 1, true);
</script>

<svelte:head>
	<title>Server status - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-4">
	<h1 class="sr-only">Server status</h1>
	<p data-testid="uptime">
		This MySQL server has been running for {timespanFormat(s.uptime)}. It started up on {startedAt}.
	</p>

	{#if data.replication.isPrimary || data.replication.isReplica}
		<Card.Root data-testid="replication-summary">
			<Card.Header>
				<Card.Title>Replication</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-1 text-sm">
				{#if data.replication.isPrimary}
					<p>
						This server is configured as primary in a replication process (binary log
						{data.replication.primaryFile}, position {data.replication.primaryPosition}).
					</p>
				{/if}
				{#if data.replication.isReplica}
					<p>
						This server is configured as replica in a replication process (IO thread: {data
							.replication.replicaIo}, SQL thread: {data.replication.replicaSql}).
					</p>
				{/if}
				<a class="text-primary underline" href={resolve(bare('/server/replication'))}>
					Replication status details
				</a>
			</Card.Content>
		</Card.Root>
	{/if}

	<div class="grid gap-4 lg:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title>Traffic</Card.Title>
				<Card.Description>
					On a busy server, the byte counters may overrun, so those statistics as reported by the
					MySQL server may be incorrect.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<Table.Root data-testid="traffic-table">
					<Table.Header>
						<Table.Row>
							<Table.Head>Traffic</Table.Head>
							<Table.Head class="text-end">#</Table.Head>
							<Table.Head class="text-end">ø per hour</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						<Table.Row>
							<Table.Cell>Received</Table.Cell>
							<Table.Cell class="text-end font-mono">{formatBytes(received)}</Table.Cell>
							<Table.Cell class="text-end font-mono">{perHour(received)}</Table.Cell>
						</Table.Row>
						<Table.Row>
							<Table.Cell>Sent</Table.Cell>
							<Table.Cell class="text-end font-mono">{formatBytes(sent)}</Table.Cell>
							<Table.Cell class="text-end font-mono">{perHour(sent)}</Table.Cell>
						</Table.Row>
						<Table.Row>
							<Table.Cell class="font-medium">Total</Table.Cell>
							<Table.Cell class="text-end font-mono">{formatBytes(received + sent)}</Table.Cell>
							<Table.Cell class="text-end font-mono">{perHour(received + sent)}</Table.Cell>
						</Table.Row>
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Connections</Card.Title>
			</Card.Header>
			<Card.Content>
				<Table.Root data-testid="connections-table">
					<Table.Header>
						<Table.Row>
							<Table.Head>Connections</Table.Head>
							<Table.Head class="text-end">#</Table.Head>
							<Table.Head class="text-end">ø per hour</Table.Head>
							<Table.Head class="text-end">%</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						<Table.Row>
							<Table.Cell>Max. concurrent connections</Table.Cell>
							<Table.Cell class="text-end font-mono">
								{formatNumber(s.maxUsedConnections, 0)}
							</Table.Cell>
							<Table.Cell class="text-end font-mono">--</Table.Cell>
							<Table.Cell class="text-end font-mono">--</Table.Cell>
						</Table.Row>
						<Table.Row>
							<Table.Cell>Failed attempts</Table.Cell>
							<Table.Cell class="text-end font-mono"
								>{formatNumber(s.abortedConnects, 4, 0)}</Table.Cell
							>
							<Table.Cell class="text-end font-mono">{perHourNum(s.abortedConnects)}</Table.Cell>
							<Table.Cell class="text-end font-mono">
								{s.connections
									? formatNumber((s.abortedConnects * 100) / s.connections, 0, 2)
									: '--'}
							</Table.Cell>
						</Table.Row>
						<Table.Row>
							<Table.Cell>Aborted</Table.Cell>
							<Table.Cell class="text-end font-mono"
								>{formatNumber(s.abortedClients, 4, 0)}</Table.Cell
							>
							<Table.Cell class="text-end font-mono">{perHourNum(s.abortedClients)}</Table.Cell>
							<Table.Cell class="text-end font-mono">
								{s.connections
									? formatNumber((s.abortedClients * 100) / s.connections, 0, 2)
									: '--'}
							</Table.Cell>
						</Table.Row>
						<Table.Row>
							<Table.Cell class="font-medium">Total</Table.Cell>
							<Table.Cell class="text-end font-mono">{formatNumber(s.connections, 4, 0)}</Table.Cell
							>
							<Table.Cell class="text-end font-mono">{perHourNum(s.connections)}</Table.Cell>
							<Table.Cell class="text-end font-mono">{s.connections ? '100.00' : '--'}</Table.Cell>
						</Table.Row>
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	</div>
</div>
