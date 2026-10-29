<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { Pagination as PaginationPrimitive } from 'bits-ui';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import { cn } from '#lib/utils.ts';

	const { t } = useI18n();

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: PaginationPrimitive.PrevButtonProps = $props();
</script>

<PaginationPrimitive.PrevButton
	bind:ref
	aria-label={t('Go to previous page')}
	class={cn(buttonVariants({ variant: 'ghost', size: 'default' }), 'pl-2!', className)}
	{...restProps}
>
	<ChevronLeftIcon data-icon="inline-start" class="cn-rtl-flip" />
	<span class="hidden sm:block">{t('Previous')}</span>
</PaginationPrimitive.PrevButton>
