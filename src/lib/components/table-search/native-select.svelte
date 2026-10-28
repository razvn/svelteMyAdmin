<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { cn } from '#lib/utils.ts';

	// Native <select>: the QBE grids hold dozens of selects (and multi-selects for ENUM), where the
	// bits-ui popover select is too heavy. Styled with the same tokens as `ui/input`.
	let { class: className, value = $bindable(), children, ...rest }: HTMLSelectAttributes = $props();
</script>

<select
	bind:value
	class={cn(
		'h-9 min-w-0 rounded-lg border border-input bg-card px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
		className
	)}
	{...rest}
>
	{@render children?.()}
</select>
