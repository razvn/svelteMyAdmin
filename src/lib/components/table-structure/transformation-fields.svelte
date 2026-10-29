<script lang="ts">
	import { resolve } from '$app/paths';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import type { ColumnTransformSettings, TransformChoices } from '#lib/transformations/ui.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		value: ColumnTransformSettings;
		choices: TransformChoices;
		/** 1-based column number, for labels. */
		n: number;
	}

	let { value = $bindable(), choices, n }: Props = $props();

	const outputTitle = $derived(
		choices.outputs.find((o) => o.key === value.transformation)?.description
	);
	const inputTitle = $derived(
		choices.inputs.find((o) => o.key === value.input_transformation)?.description
	);
</script>

{#snippet field(label: string, body: import('svelte').Snippet)}
	<div class="flex min-w-0 flex-col gap-1">
		<span class="text-xs font-medium text-muted-foreground">{label}</span>
		{@render body()}
	</div>
{/snippet}

<div class="grid grid-cols-1 gap-3 border-t pt-3 md:grid-cols-3 xl:grid-cols-5">
	{#snippet mimeField()}
		<NativeSelect bind:value={value.mimetype} aria-label={t('Media type of column {n}', { n })}>
			<NativeSelectOption value="">&nbsp;</NativeSelectOption>
			{#each choices.mimeTypes as m (m.value)}
				<NativeSelectOption value={m.value}>{m.label}</NativeSelectOption>
			{/each}
		</NativeSelect>
	{/snippet}
	{@render field(t('Media type'), mimeField)}

	{#snippet outField()}
		<NativeSelect
			bind:value={value.transformation}
			aria-label={t('Browser display transformation of column {n}', { n })}
			title={outputTitle}
		>
			<NativeSelectOption value="">&nbsp;</NativeSelectOption>
			{#each choices.outputs as o (o.key)}
				<NativeSelectOption value={o.key} disabled={o.disabled} title={o.description}
					>{o.label}</NativeSelectOption
				>
			{/each}
		</NativeSelect>
	{/snippet}
	{@render field(t('Browser display transformation'), outField)}

	{#snippet outOptions()}
		<Input
			bind:value={value.transformation_options}
			maxlength={255}
			aria-label={t('Browser display transformation options of column {n}', { n })}
			placeholder="'a', 100, b, 'c'"
			autocomplete="off"
			class="font-mono"
		/>
	{/snippet}
	{@render field(t('Browser display transformation options'), outOptions)}

	{#snippet inField()}
		<NativeSelect
			bind:value={value.input_transformation}
			aria-label={t('Input transformation of column {n}', { n })}
			title={inputTitle}
		>
			<NativeSelectOption value="">&nbsp;</NativeSelectOption>
			{#each choices.inputs as o (o.key)}
				<NativeSelectOption value={o.key} title={o.description}>{o.label}</NativeSelectOption>
			{/each}
		</NativeSelect>
	{/snippet}
	{@render field(t('Input transformation'), inField)}

	{#snippet inOptions()}
		<Input
			bind:value={value.input_transformation_options}
			maxlength={255}
			aria-label={t('Input transformation options of column {n}', { n })}
			placeholder="'a', 100, b, 'c'"
			autocomplete="off"
			class="font-mono"
		/>
	{/snippet}
	{@render field(t('Input transformation options'), inOptions)}

	<p class="text-xs text-muted-foreground md:col-span-3 xl:col-span-5">
		{t(
			"Options are written like 'a', 100, b,'c'; precede a backslash or a single quote with a backslash."
		)}
		<a class="text-primary hover:underline" href={resolve('/(app)/transformations')}
			>{t('List of available transformations')}</a
		>
	</p>
</div>
