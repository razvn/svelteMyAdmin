<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { Pagination as PaginationPrimitive } from 'bits-ui';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import { cn } from '#lib/utils.ts';

	const { t } = useI18n();

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: PaginationPrimitive.NextButtonProps = $props();
</script>

<PaginationPrimitive.NextButton
	bind:ref
	aria-label={t('Go to next page')}
	class={cn(buttonVariants({ variant: 'ghost', size: 'default' }), 'pr-2!', className)}
	{...restProps}
>
	<span class="hidden sm:block">{t('Next')}</span>
	<ChevronRightIcon data-icon="inline-end" class="cn-rtl-flip" />
</PaginationPrimitive.NextButton>
