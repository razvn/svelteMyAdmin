<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import type { Attachment } from 'svelte/attachments';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import { fitTabs } from '#lib/nav/tab-overflow.ts';
	import { isTabActive, type TabDef } from '#lib/nav/tabs.ts';
	import { cn } from '#lib/utils.ts';
	import { FALLBACK_ICON, MORE_ICON, TAB_ICONS } from './tab-icons.ts';

	interface Props {
		/** Accessible name of the navigation landmark. */
		label: string;
		tabs: TabDef[];
		/** Path below the level root of the current page. */
		current: string;
		hrefFor: (tab: TabDef) => string;
	}

	let { label, tabs, current, hrefFor }: Props = $props();

	let visibleCount = $state<number | null>(null);
	let container: HTMLElement | undefined = $state();
	let measure: HTMLElement | undefined = $state();

	const shown = $derived(visibleCount === null ? tabs : tabs.slice(0, visibleCount));
	const overflow = $derived(visibleCount === null ? [] : tabs.slice(visibleCount));
	const overflowActive = $derived(overflow.some((t) => isTabActive(t, current)));

	function recompute() {
		if (!container || !measure) return;
		const items = Array.from(measure.querySelectorAll<HTMLElement>('[data-measure-tab]'));
		const more = measure.querySelector<HTMLElement>('[data-measure-more]');
		visibleCount = fitTabs(
			items.map((el) => el.offsetWidth),
			container.clientWidth,
			more?.offsetWidth ?? 40
		);
	}

	// Re-measure when the container resizes or the set of tabs changes.
	const observe: Attachment<HTMLElement> = (node) => {
		void tabs;
		recompute();
		const observer = new ResizeObserver(recompute);
		observer.observe(node);
		return () => observer.disconnect();
	};

	const linkClass = (active: boolean) =>
		cn(buttonVariants({ variant: active ? 'secondary' : 'ghost', size: 'sm' }), 'shrink-0');
</script>

<div class="relative" data-testid="tab-bar">
	<nav
		aria-label={label}
		bind:this={container}
		{@attach observe}
		class="flex items-center gap-1 overflow-hidden"
	>
		{#each shown as tab (tab.id)}
			{@const Icon = TAB_ICONS[tab.id] ?? FALLBACK_ICON}
			{@const active = isTabActive(tab, current)}
			<a
				href={resolve(bare(hrefFor(tab)))}
				class={linkClass(active)}
				aria-current={active ? 'page' : undefined}
				data-tab={tab.id}
			>
				<Icon />
				{tab.label}
			</a>
		{/each}

		{#if overflow.length > 0}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button {...props} type="button" class={linkClass(overflowActive)}>
							<Ellipsis />
							More
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					{#each overflow as tab (tab.id)}
						{@const Icon = TAB_ICONS[tab.id] ?? FALLBACK_ICON}
						<DropdownMenu.Item>
							{#snippet child({ props })}
								<a
									{...props}
									href={resolve(bare(hrefFor(tab)))}
									aria-current={isTabActive(tab, current) ? 'page' : undefined}
								>
									<Icon />
									{tab.label}
								</a>
							{/snippet}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
	</nav>

	<!-- Invisible copy used to measure the natural width of every tab. -->
	<div
		bind:this={measure}
		aria-hidden="true"
		class="pointer-events-none invisible absolute top-0 left-0 flex h-0 gap-1 overflow-hidden"
	>
		{#each tabs as tab (tab.id)}
			{@const Icon = TAB_ICONS[tab.id] ?? FALLBACK_ICON}
			<span data-measure-tab class={linkClass(false)}>
				<Icon />
				{tab.label}
			</span>
		{/each}
		<span data-measure-more class={linkClass(false)}>
			<MORE_ICON />
			More
		</span>
	</div>
</div>
