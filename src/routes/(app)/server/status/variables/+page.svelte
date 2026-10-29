<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { filterVariables, usedCategories } from '#lib/admin/status-vars.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	const { t, fmt } = useI18n();
	const formatSi = fmt.si;
	let { data }: PageProps = $props();

	let text = $state('');
	let category = $state('all');
	let onlyAlerts = $state(false);
	let raw = $state(false);

	const categories = $derived(usedCategories(data.variables));
	const categoryLabel = $derived(
		category === 'all' ? t('All') : t(categories.find((c) => c.id === category)?.name ?? 'All')
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
		if (name.endsWith('%')) return formatSi(n, 0, 2);
		return formatSi(n, 0, Number.isInteger(n) ? 0 : 2);
	}
</script>

<svelte:head>
	<title>{t('All status variables')} - svelteMyAdmin</title>
</svelte:head>

<Card.Root class="gap-0 py-0">
	<div class="flex flex-wrap items-end gap-x-6 gap-y-4 border-b p-5">
		<div class="flex flex-col gap-1">
			<Label for="filter-text">{t('Containing the word:')}</Label>
			<Input id="filter-text" bind:value={text} placeholder={t('Filter by name')} class="w-64" />
		</div>
		<div class="flex flex-col gap-1">
			<Label>{t('Category')}</Label>
			<Select.Root type="single" bind:value={category}>
				<Select.Trigger class="w-52" aria-label={t('Category')} data-testid="category">
					{categoryLabel}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label={t('All')}>{t('All')}</Select.Item>
					{#each categories as c (c.id)}
						<Select.Item value={c.id} label={t(c.name)}>{t(c.name)}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="flex items-center gap-2 pb-2">
			<Checkbox id="only-alerts" bind:checked={onlyAlerts} />
			<Label for="only-alerts">{t('Show only alert values')}</Label>
		</div>
		<div class="flex items-center gap-2 pb-2">
			<Checkbox id="raw" bind:checked={raw} />
			<Label for="raw">{t('Show unformatted values')}</Label>
		</div>
	</div>
	<p class="border-b px-5 py-3 text-sm text-muted-foreground">
		{t(
			'Variables marked in red are above their alert threshold; values are since the last server start or FLUSH STATUS.'
		)}
	</p>

	<Table.Root data-testid="variables-table">
		<Table.Header>
			<Table.Row>
				<Table.Head>{t('Variable')}</Table.Head>
				<Table.Head class="text-end">{t('Value')}</Table.Head>
				<Table.Head>{t('Description')}</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as v (v.name)}
				<Table.Row data-variable={v.name}>
					<Table.Cell class="font-medium">{v.name.replace(/_/g, ' ')}</Table.Cell>
					<Table.Cell
						class={[
							'text-end tabular-nums',
							v.hasAlert && (v.isAlert ? 'font-semibold text-destructive' : 'text-muted-foreground')
						]}
						data-alert={v.hasAlert ? (v.isAlert ? 'true' : 'false') : undefined}
					>
						{show(v.value, v.isNumeric, v.name)}
					</Table.Cell>
					<Table.Cell class="text-sm whitespace-normal text-muted-foreground">
						{v.description ? t(v.description) : ''}
						{#if v.hasAlert}
							<Badge class="mt-1 block w-fit" variant={v.isAlert ? 'destructive' : 'success'}>
								{v.isAlert ? t('Above the recommended threshold.') : t('Within the recommended range.')}
							</Badge>
						{/if}
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell colspan={3} class="text-center text-muted-foreground">
						{t('No variables match.')}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</Card.Root>
