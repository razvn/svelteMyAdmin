<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.ts';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLUListElement>> = $props();
</script>

<ul
	bind:this={ref}
	data-slot="sidebar-menu-sub"
	data-sidebar="menu-sub"
	class={cn(
		'mx-5 flex min-w-0 translate-x-px flex-col gap-0.5 border-l border-sidebar-border px-2 py-1 group-data-[collapsible=icon]:hidden',
		'group-data-[collapsible=icon]:hidden',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</ul>
