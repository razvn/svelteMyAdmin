<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { Pagination as PaginationPrimitive } from 'bits-ui';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { cn } from '#lib/utils.ts';
	import { buttonVariants } from '../button/index.js';

	const { t } = useI18n();

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: PaginationPrimitive.PrevButtonProps = $props();
</script>

{#snippet Fallback()}
	<ChevronLeftIcon class={cn('cn-rtl-flip size-4', className)} />
	<span>{t('Previous')}</span>
{/snippet}

<PaginationPrimitive.PrevButton
	bind:ref
	aria-label={t('Go to previous page')}
	class={cn(buttonVariants({ variant: 'ghost' }), 'pl-2!', className)}
	{...restProps}
>
	{#if children}
		{@render children?.()}
	{:else}
		{@render Fallback()}
	{/if}
</PaginationPrimitive.PrevButton>
