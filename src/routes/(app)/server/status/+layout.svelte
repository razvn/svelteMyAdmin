<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import { activeStatusSubTab, STATUS_SUB_TABS } from '#lib/admin/status-tabs.ts';
	import { cn } from '#lib/utils.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const active = $derived(activeStatusSubTab(page.url.pathname));
</script>

<div class="mt-4 flex flex-col gap-4">
	<nav aria-label="Status" class="flex flex-wrap gap-1 border-b pb-2" data-testid="status-subnav">
		{#each STATUS_SUB_TABS as tab (tab.id)}
			<a
				href={resolve(bare(`/server/status${tab.path ? `/${tab.path}` : ''}`))}
				aria-current={active === tab.id ? 'page' : undefined}
				class={cn(
					buttonVariants({ variant: active === tab.id ? 'secondary' : 'ghost', size: 'sm' })
				)}
			>
				{tab.label}
			</a>
		{/each}
	</nav>
	{@render children()}
</div>
