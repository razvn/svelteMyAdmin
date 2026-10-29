<script lang="ts">
	import { page } from '$app/state';
	import Download from '@lucide/svelte/icons/download';
	import MapIcon from '@lucide/svelte/icons/map';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import NativeSelect from '#lib/components/table-search/native-select.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { downloadPng, downloadSvg, svgToPngBlob } from '#lib/chart/export.ts';
	import GisMap, { type MapRow } from '#lib/gis/gis-map.svelte';
	import { parseWkt } from '#lib/gis/wkt.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t, tn } = useI18n();
	let { data }: PageProps = $props();

	const gis = $derived(data.gis);
	let svg = $state<SVGSVGElement | null>(null);
	let tiles = $state(false);

	const parsed = $derived.by(() => {
		const rows: MapRow[] = [];
		let invalid = 0;
		for (const r of gis.rows) {
			try {
				rows.push({ label: r.label, geometry: parseWkt(r.wkt), values: r.values });
			} catch {
				invalid++;
			}
		}
		return { rows, invalid };
	});
	const srid = $derived(gis.rows[0]?.srid ?? 0);
	const filename = $derived(`${data.table}-${gis.geometryColumn || 'gis'}`);

	async function savePdf() {
		if (!svg) return;
		try {
			const png = await svgToPngBlob(svg);
			const vb = svg.viewBox.baseVal;
			const res = await fetch(
				`${page.url.pathname.replace(/\/$/, '')}/pdf?width=${vb.width}&height=${vb.height}`,
				{ method: 'POST', headers: { 'content-type': 'image/png' }, body: png }
			);
			if (!res.ok) throw new Error(t('The PDF could not be created.'));
			const url = URL.createObjectURL(await res.blob());
			const a = document.createElement('a');
			a.href = url;
			a.download = `${filename}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : t('Export failed.'));
		}
	}
	async function savePng() {
		if (!svg) return;
		try {
			await downloadPng(svg, `${filename}.png`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : t('Export failed.'));
		}
	}
</script>

<svelte:head><title>{t('GIS visualization')} - {data.table} - svelteMyAdmin</title></svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={MapIcon}
		title={t('GIS visualization')}
		description="{data.db}.{data.table} · {tn('{n} geometry', '{n} geometries', gis.total)}"
	/>

	{#if data.loadError}
		<Alert variant="destructive" data-testid="gis-error">
			<AlertDescription>{data.loadError}</AlertDescription>
		</Alert>
	{:else if gis.spatialColumns.length === 0}
		<Alert data-testid="gis-no-spatial">
			<AlertDescription>{t('This result has no spatial column to visualize.')}</AlertDescription>
		</Alert>
	{:else}
		<Card.Root>
			<Card.Content>
				<form method="GET" class="flex flex-wrap items-end gap-4" data-testid="gis-form">
					{#if data.sql}<input type="hidden" name="sql" value={data.sql} />{/if}
					<div class="flex flex-col gap-1.5">
						<Label for="gis-col">{t('Spatial column')}</Label>
						<NativeSelect id="gis-col" name="col" value={gis.geometryColumn}>
							{#each gis.spatialColumns as c (c)}<option value={c}>{c}</option>{/each}
						</NativeSelect>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="gis-label">{t('Label column')}</Label>
						<NativeSelect id="gis-label" name="label" value={gis.labelColumn}>
							<option value="">{t('(none)')}</option>
							{#each gis.columns.filter((c) => !gis.spatialColumns.includes(c)) as c (c)}
								<option value={c}>{c}</option>
							{/each}
						</NativeSelect>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="gis-limit">{t('Rows')}</Label>
						<Input id="gis-limit" name="limit" type="number" class="w-24" value={gis.limit} />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="gis-offset">{t('Start row')}</Label>
						<Input id="gis-offset" name="offset" type="number" class="w-24" value={gis.offset} />
					</div>
					<Button type="submit">{t('Go')}</Button>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex flex-row flex-wrap items-center justify-between gap-2">
				<div>
					<Card.Title>{gis.geometryColumn}</Card.Title>
					<Card.Description>
						{gis.total > gis.rows.length
							? t('{shown} shown of {total}', { shown: parsed.rows.length, total: gis.total })
							: t('{shown} shown', { shown: parsed.rows.length })}{parsed.invalid
							? `, ${t('{n} unreadable', { n: parsed.invalid })}`
							: ''} · SRID {srid}
					</Card.Description>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					{#if srid === 4326}
						<div class="flex items-center gap-2">
							<Checkbox id="gis-tiles" bind:checked={tiles} />
							<Label for="gis-tiles" class="font-normal">{t('OpenStreetMap background')}</Label>
						</div>
					{/if}
					<Button
						variant="outline"
						size="sm"
						disabled={!svg}
						onclick={() => svg && downloadSvg(svg, `${filename}.svg`)}
					>
						<Download /> SVG
					</Button>
					<Button variant="outline" size="sm" disabled={!svg} onclick={savePng}>
						<Download /> PNG
					</Button>
					<Button variant="outline" size="sm" disabled={!svg} onclick={savePdf}>
						<Download /> PDF
					</Button>
				</div>
			</Card.Header>
			<Card.Content>
				{#if parsed.rows.length === 0}
					<p class="text-sm text-muted-foreground">{t('No geometry to display.')}</p>
				{:else}
					<GisMap rows={parsed.rows} {srid} {tiles} bind:svg />
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
