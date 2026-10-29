<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import NativeSelect from '#lib/components/table-search/native-select.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import {
		buildWkt,
		EDITOR_TYPES,
		emptyParts,
		fromWkt,
		growsPoints,
		hasParts,
		isTextType,
		minPoints,
		type EditorType,
		type Part
	} from './editor.ts';

	interface Props {
		open: boolean;
		/** Current WKT of the cell. */
		value: string;
		column: string;
		onapply: (wkt: string) => void;
	}

	const i18n = useI18n();
	const { t } = i18n;
	let { open = $bindable(), value, column, onapply }: Props = $props();

	// The parent mounts this dialog when it opens, so the cell value only seeds the editor state.
	/* svelte-ignore state_referenced_locally */
	const init = fromWkt(value);
	let type = $state<EditorType>(init.type);
	let parts = $state<Part[]>(init.parts.length ? init.parts : emptyParts(init.type));
	let text = $state(init.text);

	const built = $derived(buildWkt(type, parts, text, i18n));
	const partLabel = $derived(type === 'Polygon' ? t('Ring') : t('Line'));

	function setType(next: EditorType) {
		type = next;
		parts = emptyParts(next);
		text = '';
	}
	const addPoint = (p: number) => parts[p].push({ x: '', y: '' });
	const removePoint = (p: number, i: number) => parts[p].splice(i, 1);
	const addPart = () => parts.push(emptyParts(type)[0]);
	const removePart = (p: number) => parts.splice(p, 1);

	function apply() {
		if (!built.ok) return;
		onapply(built.wkt);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-2xl" data-testid="gis-editor">
		<Dialog.Header>
			<Dialog.Title>{t('GIS data editor: {column}', { column })}</Dialog.Title>
			<Dialog.Description>
				{t(
					'Choose the geometry type and enter the coordinates. The value is inserted as WKT for ST_GeomFromText.'
				)}
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex max-h-[60vh] flex-col gap-4 overflow-auto">
			<div class="flex flex-col gap-1.5">
				<Label for="gis-type">{t('Geometry type')}</Label>
				<NativeSelect
					id="gis-type"
					class="max-w-xs"
					value={type}
					onchange={(e) => setType(e.currentTarget.value as EditorType)}
				>
					{#each EDITOR_TYPES as et (et.value)}
						<option value={et.value}>{t(et.label)}</option>
					{/each}
				</NativeSelect>
			</div>

			{#if isTextType(type)}
				<div class="flex flex-col gap-1.5">
					<Label for="gis-text">{t('WKT')}</Label>
					<Textarea
						id="gis-text"
						bind:value={text}
						rows={5}
						class="font-mono"
						placeholder={type === 'MultiPolygon'
							? 'MULTIPOLYGON(((0 0,1 0,1 1,0 0)))'
							: 'GEOMETRYCOLLECTION(POINT(1 2))'}
					/>
				</div>
			{:else}
				{#each parts as part, p (p)}
					<fieldset class="flex flex-col gap-2 rounded-lg border p-3">
						{#if hasParts(type)}
							<legend class="px-1 text-sm font-medium"
								>{t('{part} {n}', { part: partLabel, n: p + 1 })}</legend
							>
						{/if}
						{#each part.keys() as i (i)}
							<div class="flex items-center gap-2">
								<span class="w-6 text-xs text-muted-foreground">{i + 1}</span>
								<Input
									class="w-32"
									placeholder="X"
									aria-label={hasParts(type)
										? t('X {part} {n} point {i}', { part: partLabel, n: p + 1, i: i + 1 })
										: t('X point {i}', { i: i + 1 })}
									bind:value={part[i].x}
								/>
								<Input
									class="w-32"
									placeholder="Y"
									aria-label={hasParts(type)
										? t('Y {part} {n} point {i}', { part: partLabel, n: p + 1, i: i + 1 })
										: t('Y point {i}', { i: i + 1 })}
									bind:value={part[i].y}
								/>
								{#if growsPoints(type) && part.length > minPoints(type)}
									<Button
										type="button"
										size="icon-sm"
										variant="ghost"
										aria-label={t('Remove point {i}', { i: i + 1 })}
										onclick={() => removePoint(p, i)}
									>
										<Trash2 />
									</Button>
								{/if}
							</div>
						{/each}
						<div class="flex gap-2">
							{#if growsPoints(type)}
								<Button type="button" size="sm" variant="outline" onclick={() => addPoint(p)}>
									<Plus />
									{t('Add a point')}
								</Button>
							{/if}
							{#if hasParts(type) && parts.length > 1}
								<Button type="button" size="sm" variant="ghost" onclick={() => removePart(p)}>
									{type === 'Polygon' ? t('Remove ring') : t('Remove line')}
								</Button>
							{/if}
						</div>
					</fieldset>
				{/each}
				{#if hasParts(type)}
					<div>
						<Button type="button" size="sm" variant="outline" onclick={addPart}>
							<Plus />
							{type === 'Polygon' ? t('Add ring') : t('Add line')}
						</Button>
					</div>
				{/if}
			{/if}

			<div class="flex flex-col gap-1.5">
				<Label>{t('Output')}</Label>
				<pre
					class="rounded-lg border bg-muted p-3 font-mono text-sm break-all whitespace-pre-wrap"
					data-testid="gis-wkt">{built.ok ? built.wkt : ''}</pre>
				{#if !built.ok}
					<p class="text-sm text-destructive">{built.error}</p>
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (open = false)}>{t('Cancel')}</Button>
			<Button type="button" disabled={!built.ok} onclick={apply} data-testid="gis-apply"
				>{t('Go')}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
