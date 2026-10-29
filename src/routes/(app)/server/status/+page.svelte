<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import { formatUptimeShort } from '#lib/format.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import { connectionRows } from '#lib/admin/status-connections.ts';
	import Activity from '@lucide/svelte/icons/activity';
	import ArrowDownUp from '@lucide/svelte/icons/arrow-down-up';
	import Clock from '@lucide/svelte/icons/clock';
	import Plug from '@lucide/svelte/icons/plug';
	import StatCard from '#lib/components/app-shell/stat-card.svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	const { t, fmt } = useI18n();
	const formatBytes = fmt.bytes;
	const formatNumber = fmt.number;
	let { data }: PageProps = $props();

	const s = $derived(data.summary);
	const hours = $derived(s.uptime > 0 ? s.uptime / 3600 : 1);
	const startedAt = $derived(new Date(s.startedAt).toLocaleString());
	const received = $derived(s.bytesReceived);
	const sent = $derived(s.bytesSent);
	const perHour = (n: number) => formatBytes(n / hours);
	const connections = $derived(connectionRows(s));
</script>

<svelte:head>
	<title>{t('Server status')} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<section aria-label={t('Key figures')} class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<StatCard
			label={t('Uptime')}
			value={formatUptimeShort(s.uptime)}
			icon={Clock}
			tone="success"
			hint={t('Started {date}', { date: startedAt })}
		/>
		<StatCard
			label={t('Traffic')}
			value={formatBytes(received + sent)}
			icon={ArrowDownUp}
			tone="primary"
			hint={t('{amount} per hour', { amount: perHour(received + sent) })}
		/>
		<StatCard
			label={t('Connections')}
			value={formatNumber(s.connections)}
			icon={Plug}
			tone="info"
			hint={t('Max. concurrent: {n}', { n: formatNumber(s.maxUsedConnections) })}
		/>
		<StatCard
			label={t('Queries per hour')}
			value={formatNumber(data.questions / hours)}
			icon={Activity}
			tone="warning"
			hint={t('{n} since startup', { n: formatNumber(data.questions) })}
		/>
	</section>

	<p class="text-sm text-muted-foreground" data-testid="uptime">
		{t('This MySQL server has been running for {uptime}. It started up on {start}.', {
			uptime: fmt.timespan(s.uptime),
			start: startedAt
		})}
	</p>

	{#if data.replication.isPrimary || data.replication.isReplica}
		<Card.Root data-testid="replication-summary">
			<Card.Header>
				<Card.Title>{t('Replication')}</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-1 text-sm">
				{#if data.replication.isPrimary}
					<p>
						{t(
							'This server is configured as primary in a replication process (binary log {file}, position {position}).',
							{ file: data.replication.primaryFile, position: data.replication.primaryPosition }
						)}
					</p>
				{/if}
				{#if data.replication.isReplica}
					<p>
						{t(
							'This server is configured as replica in a replication process (IO thread: {io}, SQL thread: {sql}).',
							{ io: data.replication.replicaIo, sql: data.replication.replicaSql }
						)}
					</p>
				{/if}
				<a
					class="font-medium text-primary underline-offset-4 hover:underline"
					href={resolve(bare('/server/replication'))}
				>
					{t('Replication status details')}
				</a>
			</Card.Content>
		</Card.Root>
	{/if}

	<div class="grid items-start gap-6 lg:grid-cols-2">
		<Card.Root class="gap-0 py-0">
			<Card.Header class="border-b py-5">
				<Card.Title>{t('Traffic')}</Card.Title>
				<Card.Description>
					{t(
						'On a busy server, the byte counters may overrun, so those statistics as reported by the MySQL server may be incorrect.'
					)}
				</Card.Description>
			</Card.Header>
			<Card.Content class="px-0">
				<Table.Root data-testid="traffic-table">
					<Table.Header>
						<Table.Row>
							<Table.Head>{t('Traffic')}</Table.Head>
							<Table.Head class="text-end">#</Table.Head>
							<Table.Head class="text-end">{t('ø per hour')}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						<Table.Row>
							<Table.Cell>{t('Received')}</Table.Cell>
							<Table.Cell class="text-end tabular-nums">{formatBytes(received)}</Table.Cell>
							<Table.Cell class="text-end tabular-nums">{perHour(received)}</Table.Cell>
						</Table.Row>
						<Table.Row>
							<Table.Cell>{t('Sent')}</Table.Cell>
							<Table.Cell class="text-end tabular-nums">{formatBytes(sent)}</Table.Cell>
							<Table.Cell class="text-end tabular-nums">{perHour(sent)}</Table.Cell>
						</Table.Row>
						<Table.Row>
							<Table.Cell class="font-semibold">{t('Total')}</Table.Cell>
							<Table.Cell class="text-end tabular-nums">{formatBytes(received + sent)}</Table.Cell>
							<Table.Cell class="text-end tabular-nums">{perHour(received + sent)}</Table.Cell>
						</Table.Row>
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<Card.Root class="gap-0 py-0">
			<Card.Header class="border-b py-5">
				<Card.Title>{t('Connections')}</Card.Title>
			</Card.Header>
			<Card.Content class="px-0">
				<Table.Root data-testid="connections-table">
					<Table.Header>
						<Table.Row>
							<Table.Head>{t('Connections')}</Table.Head>
							<Table.Head class="text-end">#</Table.Head>
							<Table.Head class="text-end">{t('ø per hour')}</Table.Head>
							<Table.Head class="text-end">%</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each connections as row (row.name)}
							<Table.Row>
								<Table.Cell class={row.name === 'Total' ? 'font-semibold' : undefined}>
									{t(row.name)}
								</Table.Cell>
								<Table.Cell class="text-end tabular-nums">{row.number}</Table.Cell>
								<Table.Cell class="text-end tabular-nums">{row.perHour}</Table.Cell>
								<Table.Cell class="text-end tabular-nums">{row.percentage}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	</div>
</div>
