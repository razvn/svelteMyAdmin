<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import { toast } from 'svelte-sonner';
	import {
		buildChart,
		CHART_TYPES,
		type ChartSeriesInput,
		type ChartType
	} from '#lib/chart/builders.ts';
	import Chart from '#lib/chart/chart.svelte';
	import { downloadPng, downloadSvg } from '#lib/chart/export.ts';
	import { axisKindForType } from '#lib/chart/scatter.ts';
	import { isBinaryCell, type Cell } from '#lib/components/results/format.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as NativeSelect from '#lib/components/ui/native-select/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { ResultSetData } from '#lib/sql/run-types.ts';
	import { isNumericKind } from '#lib/table/column-kind.ts';

	interface Props {
		open: boolean;
		result: ResultSetData;
	}

	let { open = $bindable(), result }: Props = $props();

	const { t, tn } = useI18n();
	const fields = $derived(result.fields);
	const numeric = (i: number) => isNumericKind(fields[i].kind);

	let type = $state<ChartType>('bar');
	// Defaults: the first column is X, the numeric columns after it are the series.
	let xColumn = $state(0);
	let picked = $state<number[] | null>(null);
	let title = $state('');
	let xLabel = $state('');
	let yLabel = $state('');
	let svg = $state<SVGSVGElement | null>(null);

	const defaults = $derived.by(() => {
		const nums = fields.map((_, i) => i).filter((i) => i !== xColumn && numeric(i));
		if (nums.length) return nums.slice(0, 1);
		const other = fields.findIndex((_, i) => i !== xColumn);
		return other < 0 ? [] : [other];
	});
	const seriesCols = $derived((picked ?? defaults).filter((i) => i !== xColumn));

	function toggle(i: number, on: boolean) {
		const cur = picked ?? defaults;
		picked = on ? [...new Set([...cur, i])].sort((a, b) => a - b) : cur.filter((c) => c !== i);
	}

	const text = (c: Cell): string | null => (c === null || isBinaryCell(c) ? null : c);
	const model = $derived.by(() => {
		const xField = fields[xColumn];
		const kind = axisKindForType(xField?.type ?? 'varchar');
		const series: ChartSeriesInput[] = seriesCols.map((i) => ({
			name: fields[i].name,
			values: result.rows.map((r) => text(r[i]))
		}));
		return buildChart({
			type,
			xValues: result.rows.map((r) => text(r[xColumn])),
			xKind: type === 'timeline' && kind === 'category' ? 'time' : kind,
			series,
			title,
			xLabel,
			yLabel
		});
	});

	async function savePng() {
		if (!svg) return;
		try {
			await downloadPng(svg, `${title.trim() || 'chart'}.png`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : t('Export failed.'));
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] overflow-auto sm:max-w-4xl" data-testid="chart-dialog">
		<Dialog.Header>
			<Dialog.Title>{t('Display chart')}</Dialog.Title>
			<Dialog.Description>
				{tn(
					'Plot the result of this query ({n} row).',
					'Plot the result of this query ({n} rows).',
					result.rows.length
				)}
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="chart-type">{t('Chart type')}</Label>
				<NativeSelect.Root id="chart-type" class="w-full" bind:value={type}>
					{#each CHART_TYPES as ct (ct.value)}
						<NativeSelect.Option value={ct.value}>{t(ct.label)}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="chart-x">{t('X-axis values')}</Label>
				<NativeSelect.Root id="chart-x" class="w-full" bind:value={xColumn}>
					{#each fields as f, i (i)}
						<NativeSelect.Option value={i}>{f.name}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>
			<div class="flex flex-col gap-1.5 sm:col-span-2">
				<span class="text-sm leading-none font-medium">{t('Series')}</span>
				<div class="flex flex-wrap gap-x-5 gap-y-2" data-testid="chart-series">
					{#each fields as f, i (i)}
						{#if i !== xColumn}
							<div class="flex items-center gap-2">
								<Checkbox
									id="chart-series-{i}"
									checked={seriesCols.includes(i)}
									onCheckedChange={(v) => toggle(i, v === true)}
								/>
								<Label for="chart-series-{i}">{f.name}</Label>
							</div>
						{/if}
					{/each}
				</div>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="chart-title">{t('Title')}</Label>
				<Input id="chart-title" bind:value={title} placeholder={t('Chart title')} />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1.5">
					<Label for="chart-xlabel">{t('X-axis label')}</Label>
					<Input id="chart-xlabel" bind:value={xLabel} placeholder={t('X-axis')} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="chart-ylabel">{t('Y-axis label')}</Label>
					<Input id="chart-ylabel" bind:value={yLabel} placeholder={t('Y-axis')} />
				</div>
			</div>
		</div>

		{#if model.empty}
			<p
				class="rounded-lg border p-6 text-center text-sm text-muted-foreground"
				data-testid="chart-empty"
			>
				{type === 'pie'
					? t('There is nothing to plot: pick numeric series columns (positive values).')
					: t('There is nothing to plot: pick numeric series columns.')}
			</p>
		{:else}
			<Chart {model} bind:svg />
		{/if}

		<Dialog.Footer>
			<Button
				type="button"
				variant="outline"
				disabled={model.empty}
				onclick={() => svg && downloadSvg(svg, `${title.trim() || 'chart'}.svg`)}
			>
				<Download /> SVG
			</Button>
			<Button type="button" variant="outline" disabled={model.empty} onclick={savePng}>
				<Download /> PNG
			</Button>
			<Button type="button" onclick={() => (open = false)}>{t('Close')}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
