<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import { cn, type WithElementRef, type WithoutChildren } from '#lib/utils.ts';
	import type { HTMLAttributes } from 'svelte/elements';

	const { t } = useI18n();

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildren<WithElementRef<HTMLAttributes<HTMLSpanElement>>> = $props();
</script>

<span
	bind:this={ref}
	data-slot="breadcrumb-ellipsis"
	role="presentation"
	aria-hidden="true"
	class={cn('flex size-5 items-center justify-center [&>svg]:size-4', className)}
	{...restProps}
>
	<MoreHorizontalIcon />
	<span class="sr-only">{t('More')}</span>
</span>
