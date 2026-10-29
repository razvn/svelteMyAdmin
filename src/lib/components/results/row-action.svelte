<script lang="ts">
	import type { Component } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Tooltip from '#lib/components/ui/tooltip/index.ts';
	import { cn } from '#lib/utils.ts';

	/**
	 * Icon-only row action (link when `href` is given, button otherwise) with an accessible name and a
	 * tooltip showing `label` on hover and keyboard focus.
	 */
	let {
		icon: Icon,
		label,
		ariaLabel = label,
		href,
		destructive = false,
		onclick
	}: {
		icon: Component<{ class?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
		label: string;
		ariaLabel?: string;
		href?: string;
		destructive?: boolean;
		onclick?: () => void;
	} = $props();
</script>

<Tooltip.Provider delayDuration={200}>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon-sm"
					{href}
					{onclick}
					aria-label={ariaLabel}
					class={cn(destructive && 'text-destructive hover:text-destructive')}
				>
					<Icon class="size-4" aria-hidden="true" />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{label}</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
