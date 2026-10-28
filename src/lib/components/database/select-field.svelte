<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';

	interface Props {
		value: string;
		options: readonly string[];
		label: string;
		/** Value for an extra empty option (shown with this text), if any. */
		emptyLabel?: string;
		class?: string;
		testid?: string;
		disabled?: boolean;
	}

	let {
		value = $bindable(),
		options,
		label,
		emptyLabel,
		class: className = 'w-full',
		testid,
		disabled = false
	}: Props = $props();
</script>

<Select.Root type="single" bind:value {disabled}>
	<Select.Trigger class={className} aria-label={label} data-testid={testid}>
		{value === '' ? (emptyLabel ?? '') : value}
	</Select.Trigger>
	<Select.Content>
		{#if emptyLabel !== undefined}
			<Select.Item value="" label={emptyLabel} />
		{/if}
		{#each options as option (option)}
			<Select.Item value={option} label={option} />
		{/each}
	</Select.Content>
</Select.Root>
