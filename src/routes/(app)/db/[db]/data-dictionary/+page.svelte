<script lang="ts">
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Printer from '@lucide/svelte/icons/printer';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t, tn } = useI18n();

	let { data }: PageProps = $props();
	const dict = $derived(data.dictionary);
</script>

<div class="flex flex-col gap-6" data-testid="data-dictionary">
	<PageHeader
		icon={BookOpen}
		title={dict.database}
		description={dict.comment
			? t('Database comment: {comment}', { comment: dict.comment })
			: tn('Data dictionary, {n} table.', 'Data dictionary, {n} tables.', dict.tables.length)}
	>
		{#snippet actions()}
			<Button variant="outline" class="print:hidden" onclick={() => window.print()}>
				<Printer class="size-4" />
				{t('Print')}
			</Button>
		{/snippet}
	</PageHeader>

	{#each dict.tables as table (table.name)}
		<Card.Root class="break-inside-avoid-page gap-0 py-0" data-testid="dd-table-{table.name}">
			<Card.Header class="border-b py-5">
				<Card.Title class="font-mono">{table.name}</Card.Title>
				{#if table.comment}
					<Card.Description
						>{t('Table comments: {comment}', { comment: table.comment })}</Card.Description
					>
				{/if}
			</Card.Header>
			<Card.Content class="px-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{t('Column')}</Table.Head>
							<Table.Head>{t('Type')}</Table.Head>
							<Table.Head>{t('Null')}</Table.Head>
							<Table.Head>{t('Default')}</Table.Head>
							{#if table.hasRelation}<Table.Head>{t('Links to')}</Table.Head>{/if}
							<Table.Head>{t('Comments')}</Table.Head>
							{#if table.hasMime}<Table.Head>{t('Media type')}</Table.Head>{/if}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each table.columns as column (column.name)}
							<Table.Row>
								<Table.Cell class="font-mono whitespace-nowrap">
									{column.name}
									{#if column.isPrimary}
										<Badge variant="primary" class="ms-1">{t('Primary')}</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell class="font-mono whitespace-normal">{column.type}</Table.Cell>
								<Table.Cell>{column.nullable ? t('Yes') : t('No')}</Table.Cell>
								<Table.Cell class="font-mono whitespace-nowrap">
									{#if column.default === null && column.nullable}
										<em>NULL</em>
									{:else}
										{column.default ?? ''}
									{/if}
								</Table.Cell>
								{#if table.hasRelation}
									<Table.Cell class="font-mono">{column.relation}</Table.Cell>
								{/if}
								<Table.Cell class="whitespace-normal">{column.comment}</Table.Cell>
								{#if table.hasMime}<Table.Cell>{column.mime}</Table.Cell>{/if}
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>

				<h3 class="border-t px-6 pt-4 text-sm font-semibold">{t('Indexes')}</h3>
				{#if table.indexes.length > 0}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>{t('Keyname')}</Table.Head>
								<Table.Head>{t('Type')}</Table.Head>
								<Table.Head>{t('Unique')}</Table.Head>
								<Table.Head>{t('Packed')}</Table.Head>
								<Table.Head>{t('Column')}</Table.Head>
								<Table.Head class="text-end">{t('Cardinality')}</Table.Head>
								<Table.Head>{t('Collation')}</Table.Head>
								<Table.Head>{t('Null')}</Table.Head>
								<Table.Head>{t('Comment')}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each table.indexes as index (index.name)}
								{#each index.columns as col, i (i)}
									<Table.Row>
										{#if i === 0}
											<Table.Cell rowspan={index.columns.length} class="font-mono">
												{index.name}
											</Table.Cell>
											<Table.Cell rowspan={index.columns.length}>{index.type}</Table.Cell>
											<Table.Cell rowspan={index.columns.length}>
												{index.unique ? t('Yes') : t('No')}
											</Table.Cell>
											<Table.Cell rowspan={index.columns.length}>{index.packed}</Table.Cell>
										{/if}
										<Table.Cell class="font-mono">
											{col.name}{col.subPart ? ` (${col.subPart})` : ''}
										</Table.Cell>
										<Table.Cell class="text-end tabular-nums">{col.cardinality ?? ''}</Table.Cell>
										<Table.Cell>{col.collation}</Table.Cell>
										<Table.Cell>{col.nullable}</Table.Cell>
										{#if i === 0}
											<Table.Cell rowspan={index.columns.length} class="whitespace-normal">
												{index.comment}
											</Table.Cell>
										{/if}
									</Table.Row>
								{/each}
							{/each}
						</Table.Body>
					</Table.Root>
				{:else}
					<p class="px-6 py-3 text-sm text-muted-foreground">{t('No index defined!')}</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Content class="text-sm text-muted-foreground"
				>{t('No tables found in database.')}</Card.Content
			>
		</Card.Root>
	{/each}
</div>
