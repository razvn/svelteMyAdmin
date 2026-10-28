<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { formatByteDown, formatNumber } from '#lib/format.ts';
	import type { PartitionData } from '#lib/server/table/structure.ts';

	interface Props {
		partitions: PartitionData | null;
	}

	let { partitions }: Props = $props();

	const bytes = (n: number): string => {
		const r = formatByteDown(n, 3, 1);
		return r ? `${r[0]} ${r[1]}` : '0 B';
	};
	const rangeOrList = $derived(partitions !== null && /^(RANGE|LIST)/.test(partitions.method));
	const describe = (method: string, expr: string, desc: string): string =>
		method.startsWith('LIST') ? `${expr} IN (${desc})` : `${expr} < ${desc}`;
</script>

<Card.Root class="gap-0 py-0" id="partitions" data-testid="partitions-card">
	<Card.Header class="border-b py-5">
		<Card.Title>Partitions</Card.Title>
		{#if partitions}
			<Card.Description>
				Partitioned by <code class="font-mono">{partitions.method}({partitions.expression})</code>
				{#if partitions.subMethod}
					, sub partitioned by
					<code class="font-mono">{partitions.subMethod}({partitions.subExpression})</code>
				{/if}
			</Card.Description>
		{:else}
			<Card.Description>No partitioning defined.</Card.Description>
		{/if}
	</Card.Header>
	{#if partitions}
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-10">#</Table.Head>
						<Table.Head>Partition</Table.Head>
						{#if rangeOrList}<Table.Head>Expression</Table.Head>{/if}
						<Table.Head class="text-end">Rows</Table.Head>
						<Table.Head class="text-end">Data length</Table.Head>
						<Table.Head class="text-end">Index length</Table.Head>
						<Table.Head>Comment</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each partitions.partitions as p (p.name)}
						<Table.Row data-testid="partition-{p.name}">
							<Table.Cell>{p.ordinal}</Table.Cell>
							<Table.Cell class="font-mono font-medium">{p.name}</Table.Cell>
							{#if rangeOrList}
								<Table.Cell class="font-mono text-xs">
									{describe(partitions.method, partitions.expression, p.description)}
								</Table.Cell>
							{/if}
							<Table.Cell class="text-end tabular-nums">{formatNumber(p.rows)}</Table.Cell>
							<Table.Cell class="text-end tabular-nums">{bytes(p.dataLength)}</Table.Cell>
							<Table.Cell class="text-end tabular-nums">{bytes(p.indexLength)}</Table.Cell>
							<Table.Cell>{p.comment}</Table.Cell>
						</Table.Row>
						{#each p.subPartitions as s (s.name)}
							<Table.Row class="bg-muted/30">
								<Table.Cell>{p.ordinal}.{s.ordinal}</Table.Cell>
								<Table.Cell class="pl-6 font-mono text-muted-foreground">{s.name}</Table.Cell>
								{#if rangeOrList}<Table.Cell></Table.Cell>{/if}
								<Table.Cell class="text-end tabular-nums">{formatNumber(s.rows)}</Table.Cell>
								<Table.Cell class="text-end tabular-nums">{bytes(s.dataLength)}</Table.Cell>
								<Table.Cell class="text-end tabular-nums">{bytes(s.indexLength)}</Table.Cell>
								<Table.Cell>{s.comment}</Table.Cell>
							</Table.Row>
						{/each}
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	{/if}
</Card.Root>
