<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import ScatterChart from '#lib/chart/scatter-chart.svelte';
	import ChartScatter from '@lucide/svelte/icons/chart-scatter';
	import SquarePen from '@lucide/svelte/icons/square-pen';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import CriterionCells from '#lib/components/table-search/criterion-cells.svelte';
	import NativeSelect from '#lib/components/table-search/native-select.svelte';
	import SearchNav from '#lib/components/table-search/search-nav.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Sheet from '#lib/components/ui/sheet/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const db = $derived(page.params.db ?? '');
	const table = $derived(page.params.table ?? '');
	const SLOTS = [0, 1, 2, 3];

	// Column chosen per slot; starts from the request so the form survives a submit.
	let chosen = $state(untrack(() => data.form.cols.slice()));
	const hasGeometry = $derived(data.columns.some((c) => c.isGeometry));
	const search = $derived(page.url.searchParams);

	function initialFor(k: number) {
		return {
			operator: search.get(`op_${k}`) ?? undefined,
			values: search.getAll(`val_${k}`),
			value2: search.get(`val2_${k}`) ?? undefined,
			geomFunc: search.get(`geom_${k}`) ?? undefined
		};
	}

	const plot = $derived(data.plot);
	const labelIndex = $derived(plot ? plot.columnNames.indexOf(plot.labelColumn) : -1);
	const xIndex = $derived(plot ? plot.columnNames.indexOf(plot.x.name) : -1);
	const yIndex = $derived(plot ? plot.columnNames.indexOf(plot.y.name) : -1);
	const chartPoints = $derived(
		plot
			? plot.points.map((p) => ({
					id: p.id,
					x: p.x,
					y: p.y,
					tip: [
						{ name: plot.x.name, value: p.values[xIndex] ?? 'NULL' },
						{ name: plot.y.name, value: p.values[yIndex] ?? 'NULL' },
						...(labelIndex >= 0 && labelIndex !== xIndex && labelIndex !== yIndex
							? [{ name: plot.labelColumn, value: p.values[labelIndex] ?? 'NULL' }]
							: [])
					]
				}))
			: []
	);

	let selectedId = $state<number | null>(null);
	let sheetOpen = $state(false);
	const selectedPoint = $derived(plot?.points.find((p) => p.id === selectedId) ?? null);
</script>

<svelte:head>
	<title>Zoom search - {table} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={ChartScatter}
		title="Zoom search"
		description="Plot the rows of {table} matching up to four criteria; the first two columns are the X and Y axes."
	/>
	<SearchNav {db} {table} current="zoom-search" />

	<form method="GET" data-testid="zoom-form" class="flex flex-col gap-6">
		<input type="hidden" name="go" value="1" />
		<Card.Root>
			<Card.Header>
				<Card.Title>Do a "query by example" (wildcard: "%") for two different columns</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-6 overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Column</Table.Head>
							<Table.Head>Type</Table.Head>
							<Table.Head>Collation</Table.Head>
							{#if hasGeometry}<Table.Head>Function</Table.Head>{/if}
							<Table.Head>Operator</Table.Head>
							<Table.Head>Value</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each SLOTS as k (k)}
							{@const column = data.columns.find((c) => c.name === chosen[k]) ?? null}
							{#if k === 2}
								<Table.Row>
									<Table.Cell
										colspan={hasGeometry ? 6 : 5}
										class="bg-muted/50 font-medium text-muted-foreground"
									>
										Additional search criteria
									</Table.Cell>
								</Table.Row>
							{/if}
							<Table.Row data-testid="zoom-slot-{k}">
								<Table.Cell>
									<NativeSelect
										name="col_{k}"
										bind:value={chosen[k]}
										aria-label={k === 0
											? 'X axis column'
											: k === 1
												? 'Y axis column'
												: `Additional column ${k - 1}`}
									>
										<option value="">{k < 2 ? 'Select a column' : 'None'}</option>
										{#each data.columns as c (c.name)}
											<option value={c.name}>{c.name}</option>
										{/each}
									</NativeSelect>
									{#if k < 2}
										<span class="ms-2 text-xs text-muted-foreground"
											>{k === 0 ? 'X axis' : 'Y axis'}</span
										>
									{/if}
								</Table.Cell>
								{#if column}
									<Table.Cell class="font-mono text-xs text-muted-foreground" dir="ltr">
										{column.type}
									</Table.Cell>
									<Table.Cell class="text-xs text-muted-foreground">{column.collation}</Table.Cell>
									{#key column.name}
										<CriterionCells
											{column}
											key={k}
											withGeometry={hasGeometry}
											initial={initialFor(k)}
										/>
									{/key}
								{:else}
									<Table.Cell colspan={hasGeometry ? 5 : 4}></Table.Cell>
								{/if}
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>

				<div class="flex flex-wrap items-end gap-6">
					<div class="flex flex-col gap-2">
						<Label for="zoom-label">Use this column to label each point</Label>
						<NativeSelect id="zoom-label" name="label" value={data.form.label}>
							<option value="">None</option>
							{#each data.columns as c (c.name)}
								<option value={c.name}>{c.name}</option>
							{/each}
						</NativeSelect>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="zoom-limit">Maximum rows to plot</Label>
						<Input
							id="zoom-limit"
							name="limit"
							type="number"
							min="1"
							max="100000"
							value={String(data.form.limit)}
							class="w-32"
						/>
					</div>
				</div>
			</Card.Content>
			<Card.Footer>
				<Button type="submit">Go</Button>
			</Card.Footer>
		</Card.Root>
	</form>

	{#if data.error}
		<Alert variant="destructive"><AlertDescription>{data.error}</AlertDescription></Alert>
	{/if}

	{#if plot}
		<Card.Root data-testid="zoom-result">
			<Card.Header>
				<Card.Title>{plot.y.name} by {plot.x.name}</Card.Title>
				<Card.Description>
					{plot.points.length} point{plot.points.length === 1 ? '' : 's'} plotted
					{#if plot.total >= plot.limit}(limited to {plot.limit} rows){/if}
					{#if plot.skipped > 0}, {plot.skipped} row{plot.skipped === 1 ? '' : 's'} without a usable value
						skipped{/if}. Click a point to see the row.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if plot.points.length === 0}
					<p class="text-sm text-muted-foreground">No rows to plot.</p>
				{:else}
					<ScatterChart
						points={chartPoints}
						xAxis={plot.x.axis}
						yAxis={plot.y.axis}
						xTitle={plot.x.name}
						yTitle={plot.y.name}
						selected={selectedId}
						onselect={(id) => {
							selectedId = id;
							sheetOpen = true;
						}}
					/>
				{/if}
			</Card.Content>
		</Card.Root>

		<Sheet.Root bind:open={sheetOpen}>
			<Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-md">
				<Sheet.Header>
					<Sheet.Title>Row details</Sheet.Title>
					<Sheet.Description>All column values of the selected point.</Sheet.Description>
				</Sheet.Header>
				{#if selectedPoint}
					<dl class="flex flex-col gap-3 px-4 text-sm" data-testid="zoom-row">
						{#each plot.columnNames as name, i (name)}
							<div>
								<dt class="text-xs font-medium text-muted-foreground">{name}</dt>
								<dd class="font-mono break-all">
									{#if selectedPoint.values[i] === null}
										<span class="text-muted-foreground italic">NULL</span>
									{:else}
										{selectedPoint.values[i]}
									{/if}
								</dd>
							</div>
						{/each}
					</dl>
					{#if selectedPoint.editHref}
						<Sheet.Footer>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- signed URL built on the server -->
							<a href={selectedPoint.editHref} class={buttonVariants()}>
								<SquarePen /> Edit this row
							</a>
						</Sheet.Footer>
					{/if}
				{/if}
			</Sheet.Content>
		</Sheet.Root>
	{/if}
</div>
