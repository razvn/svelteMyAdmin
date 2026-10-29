<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import { bare } from '#lib/nav/paths.ts';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { TAB_STRIP, tabLinkClass } from '#lib/components/app-shell/tab-styles.ts';
	import { PREF_FORMS } from '#lib/preferences/forms.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const tabs = [
		{ href: '/server/settings', label: 'Manage your settings', key: 'manage' },
		...PREF_FORMS.map((f) => ({ href: `/server/settings/${f.id}`, label: f.title, key: f.id })),
		{ href: '/server/settings/two-factor', label: 'Two-factor authentication', key: 'two-factor' }
	];
	const path = $derived(page.url.pathname.replace(/\/$/, ''));
</script>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={SlidersHorizontal}
		title="Settings"
		description="Your personal preferences. They override the server defaults for your account only."
	/>

	<nav aria-label="Settings sections" class="{TAB_STRIP} flex flex-wrap gap-0.5">
		{#each tabs as tab (tab.key)}
			<a
				href={resolve(bare(tab.href))}
				class={tabLinkClass(path === tab.href)}
				aria-current={path === tab.href ? 'page' : undefined}
				data-testid="settings-tab-{tab.key}"
			>
				{tab.label}
			</a>
		{/each}
	</nav>

	{@render children()}
</div>
