<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- hrefs carry the account query string */
	import { accountTabHref, accountTabsFor, type AccountTab } from '#lib/nav/account-tabs.ts';
	import { TAB_STRIP, tabLinkClass } from '#lib/components/app-shell/tab-styles.ts';
	import type { Account, PrivServer } from '#lib/sql/privileges/index.ts';

	interface Props {
		account: Account;
		active: AccountTab['id'];
		server?: PrivServer;
		tabs?: readonly AccountTab[];
	}

	let { account, active, server, tabs }: Props = $props();
	const shown = $derived(tabs ?? accountTabsFor(server));
</script>

<div class={TAB_STRIP} data-testid="account-tabs">
	<nav aria-label="Account" class="flex items-center gap-0.5 overflow-x-auto">
		{#each shown as tab (tab.id)}
			{#if tab.available}
				<a
					href={accountTabHref(tab.id, account)}
					class={tabLinkClass(tab.id === active)}
					aria-current={tab.id === active ? 'page' : undefined}
					data-tab={tab.id}
				>
					{tab.label}
				</a>
			{:else}
				<span
					class="{tabLinkClass(false)} cursor-not-allowed opacity-50"
					aria-disabled="true"
					title="Coming soon"
					data-tab={tab.id}
				>
					{tab.label}
				</span>
			{/if}
		{/each}
	</nav>
</div>
