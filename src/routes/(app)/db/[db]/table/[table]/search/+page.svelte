<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Search from '@lucide/svelte/icons/search';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import CriterionCells from '#lib/components/table-search/criterion-cells.svelte';
	import NativeSelect from '#lib/components/table-search/native-select.svelte';
	import SearchNav from '#lib/components/table-search/search-nav.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	let { data }: PageProps = $props();

	const db = $derived(page.params.db ?? '');
	const table = $derived(page.params.table ?? '');
</script>

<svelte:head>
	<title>{t('Search')} - {table} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Search}
		title={t('Search')}
		description={t('Do a "query by example" on {table} (wildcard: "%").', { table })}
	/>
	<SearchNav {db} {table} current="search" />

	<form method="POST" use:enhance data-testid="table-search-form" class="flex flex-col gap-6">
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Do a "query by example" (wildcard: "%")')}</Card.Title>
			</Card.Header>
			<Card.Content class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{t('Column')}</Table.Head>
							<Table.Head>{t('Type')}</Table.Head>
							<Table.Head>{t('Collation')}</Table.Head>
							{#if data.hasGeometry}<Table.Head>{t('Function')}</Table.Head>{/if}
							<Table.Head>{t('Operator')}</Table.Head>
							<Table.Head>{t('Value')}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.columns as column (column.name)}
							<Table.Row data-testid="qbe-row-{column.name}">
								<Table.Cell class="font-medium">{column.name}</Table.Cell>
								<Table.Cell class="font-mono text-xs text-muted-foreground" dir="ltr">
									{column.type}
								</Table.Cell>
								<Table.Cell class="text-xs text-muted-foreground">{column.collation}</Table.Cell>
								<CriterionCells {column} key={column.index} withGeometry={data.hasGeometry} />
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Options')}</Card.Title>
				<Card.Description>
					{t('These choices are passed to Browse; the selected columns are only a hint.')}
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-6 md:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="columnsToDisplay">{t('Select columns (at least one):')}</Label>
					<NativeSelect
						id="columnsToDisplay"
						name="columnsToDisplay"
						multiple
						size={Math.min(data.columns.length, 10)}
						class="h-auto"
					>
						{#each data.columns as column (column.name)}
							<option value={column.name} selected>{column.name}</option>
						{/each}
					</NativeSelect>
				</div>
				<div class="flex flex-col gap-4">
					<div class="flex flex-col gap-2">
						<Label for="customWhere">
							{t('Or add search conditions (body of the "where" clause):')}
						</Label>
						<Input id="customWhere" name="customWhere" autocomplete="off" placeholder="id &gt; 3" />
					</div>
					<div class="flex flex-col gap-2">
						<Label for="maxRows">{t('Number of rows per page')}</Label>
						<Input
							id="maxRows"
							name="maxRows"
							type="number"
							min="1"
							value={String(data.maxRows)}
							class="w-32"
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="orderBy">{t('Display order:')}</Label>
						<div class="flex flex-wrap items-center gap-3">
							<NativeSelect id="orderBy" name="orderBy">
								<option value=""></option>
								{#each data.columns as column (column.name)}
									<option value={column.name}>{column.name}</option>
								{/each}
							</NativeSelect>
							<label class="flex items-center gap-1.5 text-sm">
								<input type="radio" name="order" value="ASC" checked /> {t('Ascending')}
							</label>
							<label class="flex items-center gap-1.5 text-sm">
								<input type="radio" name="order" value="DESC" /> {t('Descending')}
							</label>
						</div>
					</div>
				</div>
			</Card.Content>
			<Card.Footer>
				<Button type="submit">{t('Go')}</Button>
			</Card.Footer>
		</Card.Root>
	</form>
</div>
