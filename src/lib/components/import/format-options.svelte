<script lang="ts">
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import { optionsFor, type ImportLevel } from '#lib/import/options.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { ImportFormat, ImportOptionValues } from '#lib/import/types.ts';

	interface Props {
		format: ImportFormat;
		level: ImportLevel;
		/** Option values of this format (mutated in place). */
		values: ImportOptionValues;
		compatibilities: string[];
	}

	let { format, level, values = $bindable(), compatibilities }: Props = $props();
	const { t } = useI18n();

	const defs = $derived(optionsFor(format, level));
</script>

{#if defs.length === 0}
	<p class="text-sm text-muted-foreground">{t('This format has no options.')}</p>
{:else}
	<div class="grid gap-4 sm:grid-cols-2" data-testid="format-options">
		{#each defs as o (o.name)}
			{@const id = `opt-${format}-${o.name}`}
			{#if o.kind === 'bool'}
				<div class="flex items-start gap-2 sm:col-span-2">
					<Checkbox
						{id}
						name={o.name}
						bind:checked={() => values[o.name] === true, (v) => (values[o.name] = v)}
					/>
					<Label for={id} class="leading-snug font-normal">{t(o.label)}</Label>
				</div>
			{:else if o.kind === 'select'}
				<div class="grid gap-1.5">
					<Label for={id}>{t(o.label)}</Label>
					<NativeSelect
						{id}
						name={o.name}
						bind:value={() => String(values[o.name] ?? o.default), (v) => (values[o.name] = v)}
					>
						{#each compatibilities as c (c)}
							<NativeSelectOption value={c}>{c}</NativeSelectOption>
						{/each}
					</NativeSelect>
				</div>
			{:else}
				<div class="grid gap-1.5">
					<Label for={id}>{t(o.label)}</Label>
					<Input
						{id}
						name={o.name}
						type={o.kind === 'number' ? 'number' : 'text'}
						min={o.kind === 'number' ? 0 : undefined}
						class={o.short ? 'w-28 font-mono' : 'max-w-sm'}
						autocomplete="off"
						bind:value={
							() => String(values[o.name] ?? ''),
							(v) => (values[o.name] = o.kind === 'number' ? Number(v) || 0 : v)
						}
					/>
					{#if o.help}
						<p class="text-xs text-muted-foreground">{t(o.help)}</p>
					{/if}
				</div>
			{/if}
		{/each}
	</div>
{/if}
