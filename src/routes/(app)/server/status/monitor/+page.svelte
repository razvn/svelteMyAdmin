<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import Plus from '@lucide/svelte/icons/plus';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import AddChartDialog from '#lib/components/monitor/add-chart-dialog.svelte';
	import ChartGrid from '#lib/components/monitor/chart-grid.svelte';
	import LogPanel from '#lib/components/monitor/log-panel.svelte';
	import { Alert } from '#lib/components/ui/alert/index.ts';
	import * as AlertParts from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import {
		chartValues,
		emptyHistory,
		parseSample,
		pushSample,
		requiredPoints,
		type ChartHistory
	} from '#lib/monitor/math.ts';
	import {
		DEFAULT_SETTINGS,
		REFRESH_RATES,
		loadSettings,
		newChartId,
		refreshLabel,
		saveSettings
	} from '#lib/monitor/presets.ts';
	import type {
		ChartDef,
		MonitorDataResponse,
		MonitorSettings,
		RawSample
	} from '#lib/monitor/types.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t } = useI18n();
	let { data }: PageProps = $props();

	let settings = $state<MonitorSettings>(structuredClone(DEFAULT_SETTINGS));
	let loaded = $state(false);
	let paused = $state(false);
	let addOpen = $state(false);
	let error = $state('');
	let histories = $state<Record<string, ChartHistory>>({});
	let selection = $state<{ start: number; end: number } | null>(null);
	let prev: { raw: RawSample; at: number } | null = null;

	onMount(() => {
		settings = loadSettings(localStorage);
		loaded = true;
	});

	$effect(() => {
		if (loaded) saveSettings(localStorage, $state.snapshot(settings));
	});

	async function tick() {
		const charts = untrack(() => settings.charts);
		if (charts.length === 0) return;
		try {
			const res = await fetch(resolve(bare('/server/status/monitor/data')), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ points: requiredPoints(charts) })
			});
			if (!res.ok) throw new Error(String(res.status));
			const json = (await res.json()) as MonitorDataResponse;
			const raw = parseSample(json.values);
			const seconds = prev ? (json.x - prev.at) / 1000 : 0;
			const next = { ...histories };
			for (const chart of charts) {
				const values = chartValues(chart, prev?.raw ?? null, raw, seconds);
				next[chart.id] = pushSample(next[chart.id] ?? emptyHistory(chart), json.x, values);
			}
			histories = next;
			prev = { raw, at: json.x };
			error = '';
		} catch {
			error = t('Could not fetch monitor data.');
		}
	}

	// Poll: once right away, then every `refresh` seconds, unless paused.
	$effect(() => {
		if (!loaded || paused) return;
		const ms = settings.refresh * 1000;
		void tick();
		const id = setInterval(() => void tick(), ms);
		return () => clearInterval(id);
	});

	function addChart(chart: ChartDef) {
		settings.charts = [...settings.charts, chart];
	}

	function removeChart(id: string) {
		settings.charts = settings.charts.filter((c) => c.id !== id);
		const { [id]: _gone, ...rest } = histories;
		void _gone;
		histories = rest;
	}

	function moveChart(id: string, delta: -1 | 1) {
		const list = [...settings.charts];
		const i = list.findIndex((c) => c.id === id);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j], list[i]];
		settings.charts = list;
	}

	function reset() {
		settings = structuredClone(DEFAULT_SETTINGS);
		histories = {};
		prev = null;
	}

	const refreshValue = {
		get v() {
			return String(settings.refresh);
		},
		set v(s: string) {
			settings.refresh = Number(s);
		}
	};
	const columnsValue = {
		get v() {
			return String(settings.columns);
		},
		set v(s: string) {
			settings.columns = Number(s) as 2 | 3 | 4;
		}
	};
</script>

<svelte:head>
	<title>{t('Monitor')} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6" data-testid="monitor">
	<Card.Root class="py-4">
		<Card.Content class="flex flex-wrap items-end gap-x-4 gap-y-3">
			<Button onclick={() => (addOpen = true)} data-testid="add-chart">
				<Plus />
				{t('Add chart')}
			</Button>
			<Button
				variant="outline"
				onclick={() => (paused = !paused)}
				aria-pressed={paused}
				data-testid="pause"
			>
				{#if paused}<Play /> {t('Resume')}{:else}<Pause /> {t('Pause')}{/if}
			</Button>
			<div class="flex flex-col gap-1">
				<Label for="refresh-rate" class="text-xs text-muted-foreground">{t('Refresh rate')}</Label>
				<NativeSelect
					id="refresh-rate"
					bind:value={refreshValue.v}
					size="sm"
					data-testid="refresh-rate"
				>
					{#each REFRESH_RATES as r (r)}
						<NativeSelectOption value={String(r)}>{refreshLabel(r, t)}</NativeSelectOption>
					{/each}
				</NativeSelect>
			</div>
			<div class="flex flex-col gap-1">
				<Label for="chart-columns" class="text-xs text-muted-foreground">{t('Columns')}</Label>
				<NativeSelect
					id="chart-columns"
					bind:value={columnsValue.v}
					size="sm"
					data-testid="chart-columns"
				>
					{#each [2, 3, 4] as c (c)}
						<NativeSelectOption value={String(c)}>{c}</NativeSelectOption>
					{/each}
				</NativeSelect>
			</div>
			<Button variant="ghost" onclick={reset} data-testid="reset-charts">
				<RotateCcw />
				{t('Reset to defaults')}
			</Button>
			{#if paused}
				<span class="text-sm text-muted-foreground" data-testid="paused-note">{t('Paused')}</span>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if error}
		<Alert variant="destructive"><AlertParts.Description>{error}</AlertParts.Description></Alert>
	{/if}

	<ChartGrid
		charts={settings.charts}
		{histories}
		columns={settings.columns}
		onremove={removeChart}
		onmove={moveChart}
		onselect={(r) => (selection = { start: r.start, end: r.end })}
		{selection}
	/>

	<p class="text-xs text-muted-foreground">
		{t(
			'System charts (CPU, memory, swap) are not offered: phpMyAdmin only shows them when the database server runs on the same host as the web application, which cannot be assumed here.'
		)}
	</p>

	{#if data.logging}
		<LogPanel vars={data.logging} {selection} />
	{/if}
</div>

<AddChartDialog
	bind:open={addOpen}
	statusNames={data.statusNames}
	nextId={() => newChartId(settings.charts)}
	onadd={addChart}
/>
