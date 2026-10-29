<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { cn, type WithElementRef } from '#lib/utils.ts';
	import type { HTMLAttributes } from 'svelte/elements';

	const { t } = useI18n();

	let {
		ref = $bindable(null),
		class: className,
		children,
		showCloseButton = false,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		showCloseButton?: boolean;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="dialog-footer"
	class={cn('flex flex-col-reverse gap-2 gap-2 sm:flex-row sm:justify-end', className)}
	{...restProps}
>
	{@render children?.()}
	{#if showCloseButton}
		<DialogPrimitive.Close>
			{#snippet child({ props })}
				<Button variant="outline" {...props}>{t('Close')}</Button>
			{/snippet}
		</DialogPrimitive.Close>
	{/if}
</div>
