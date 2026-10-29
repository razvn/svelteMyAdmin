<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { Pagination as PaginationPrimitive } from 'bits-ui';
	import { cn } from '#lib/utils.ts';

	const { t } = useI18n();

	let {
		ref = $bindable(null),
		class: className,
		count = 0,
		perPage = 10,
		page = $bindable(1),
		siblingCount = 1,
		...restProps
	}: PaginationPrimitive.RootProps = $props();
</script>

<PaginationPrimitive.Root
	bind:ref
	bind:page
	role="navigation"
	aria-label={t('Pagination')}
	data-slot="pagination"
	{count}
	{perPage}
	{siblingCount}
	class={cn('mx-auto flex w-full justify-center', className)}
	{...restProps}
/>
