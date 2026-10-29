<script lang="ts">
	import { resolve } from '$app/paths';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import type { ColumnTransformSettings, TransformChoices } from '#lib/transformations/ui.ts';

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
		<NativeSelect bind:value={value.mimetype} aria-label="Media type of column {n}">
			<NativeSelectOption value="">&nbsp;</NativeSelectOption>
			{#each choices.mimeTypes as m (m.value)}
				<NativeSelectOption value={m.value}>{m.label}</NativeSelectOption>
			{/each}
		</NativeSelect>
	{/snippet}
	{@render field('Media type', mimeField)}

	{#snippet outField()}
		<NativeSelect
			bind:value={value.transformation}
			aria-label="Browser display transformation of column {n}"
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
	{@render field('Browser display transformation', outField)}

	{#snippet outOptions()}
		<Input
			bind:value={value.transformation_options}
			maxlength={255}
			aria-label="Browser display transformation options of column {n}"
			placeholder="'a', 100, b, 'c'"
			autocomplete="off"
			class="font-mono"
		/>
	{/snippet}
	{@render field('Browser display transformation options', outOptions)}

	{#snippet inField()}
		<NativeSelect
			bind:value={value.input_transformation}
			aria-label="Input transformation of column {n}"
			title={inputTitle}
		>
			<NativeSelectOption value="">&nbsp;</NativeSelectOption>
			{#each choices.inputs as o (o.key)}
				<NativeSelectOption value={o.key} title={o.description}>{o.label}</NativeSelectOption>
			{/each}
		</NativeSelect>
	{/snippet}
	{@render field('Input transformation', inField)}

	{#snippet inOptions()}
		<Input
			bind:value={value.input_transformation_options}
			maxlength={255}
			aria-label="Input transformation options of column {n}"
			placeholder="'a', 100, b, 'c'"
			autocomplete="off"
			class="font-mono"
		/>
	{/snippet}
	{@render field('Input transformation options', inOptions)}

	<p class="text-xs text-muted-foreground md:col-span-3 xl:col-span-5">
		Options are written like <code class="font-mono">'a', 100, b,'c'</code>; precede a backslash or
		a single quote with a backslash. See the
		<a class="text-primary hover:underline" href={resolve('/(app)/transformations')}
			>list of available transformations</a
		>.
	</p>
</div>
