<script lang="ts">
	import { formatNumber } from '#lib/admin/format.ts';
	import { filterVariables, usedCategories } from '#lib/admin/status-vars.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let text = $state('');
	let category = $state('all');
	let onlyAlerts = $state(false);
	let raw = $state(false);

	const categories = $derived(usedCategories(data.variables));
	const categoryLabel = $derived(
		category === 'all' ? 'All' : (categories.find((c) => c.id === category)?.name ?? 'All')
	);
	const rows = $derived(
		filterVariables(data.variables, {
			text,
			category: category === 'all' ? '' : category,
			onlyAlerts
		})
	);

	function show(value: string, numeric: boolean, name: string): string {
		if (raw || !numeric) return value;
		const n = Number(value);
		if (name.endsWith('%')) return formatNumber(n, 0, 2);
		return formatNumber(n, 0, Number.isInteger(n) ? 0 : 2);
	}
</script>

<svelte:head>
	<title>Status variables - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-4">
	<h1 class="sr-only">All status variables</h1>
	<p class="text-sm text-muted-foreground">
		Variables marked in red are above their alert threshold; values are since the last server start
		or FLUSH STATUS.
	</p>

	<div class="flex flex-wrap items-end gap-4">
		<div class="flex flex-col gap-1">
			<Label for="filter-text">Containing the word</Label>
			<Input id="filter-text" bind:value={text} placeholder="Filter by name" class="w-64" />
		</div>
		<div class="flex flex-col gap-1">
			<Label>Category</Label>
			<Select.Root type="single" bind:value={category}>
				<Select.Trigger class="w-52" aria-label="Category" data-testid="category">
					{categoryLabel}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label="All">All</Select.Item>
					{#each categories as c (c.id)}
						<Select.Item value={c.id} label={c.name}>{c.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="flex items-center gap-2 pb-2">
			<Checkbox id="only-alerts" bind:checked={onlyAlerts} />
			<Label for="only-alerts">Show only alert values</Label>
		</div>
		<div class="flex items-center gap-2 pb-2">
			<Checkbox id="raw" bind:checked={raw} />
			<Label for="raw">Show unformatted values</Label>
		</div>
	</div>

	<Table.Root data-testid="variables-table">
		<Table.Header>
			<Table.Row>
				<Table.Head>Variable</Table.Head>
				<Table.Head class="text-end">Value</Table.Head>
				<Table.Head>Description</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as v (v.name)}
				<Table.Row data-variable={v.name}>
					<Table.Cell class="font-mono">{v.name.replace(/_/g, ' ')}</Table.Cell>
					<Table.Cell
						class={[
							'text-end font-mono',
							v.hasAlert && (v.isAlert ? 'text-destructive' : 'text-muted-foreground')
						]}
						data-alert={v.hasAlert ? (v.isAlert ? 'true' : 'false') : undefined}
					>
						{show(v.value, v.isNumeric, v.name)}
					</Table.Cell>
					<Table.Cell class="text-sm text-muted-foreground">
						{v.description}
						{#if v.hasAlert}
							<span class="block text-xs">
								{v.isAlert ? 'Above the recommended threshold.' : 'Within the recommended range.'}
							</span>
						{/if}
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell colspan={3} class="text-center text-muted-foreground">
						No variables match.
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
