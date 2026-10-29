<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import type { Snippet } from 'svelte';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import AccountTabs from '#lib/components/privileges/account-tabs.svelte';
	import StatementList from '#lib/components/privileges/statement-list.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import type { AccountTab } from '#lib/nav/account-tabs.ts';
	import type { Account, PrivServer } from '#lib/sql/privileges/index.ts';

	interface FormResult {
		saved?: string;
		error?: string | null;
		results?: { statement: string; ok: boolean; error?: string }[];
	}

	interface Props {
		account: Account;
		server: PrivServer;
		active: AccountTab['id'];
		state: 'ok' | 'denied' | 'missing';
		error?: string;
		form?: FormResult | null;
		children: Snippet;
	}

	let { account, server, active, state, error = '', form, children }: Props = $props();
	const title = $derived(`'${account.user}'@'${account.noHost ? '' : account.host}'`);
</script>

<div class="flex flex-col gap-6">
	<PageHeader icon={UserCog} title="Edit privileges: User account {title}">
		{#snippet actions()}
			<Button variant="outline" href="/server/privileges"><ArrowLeft /> User accounts</Button>
		{/snippet}
	</PageHeader>

	{#if state === 'denied'}
		<Alert variant="destructive" role="alert">
			<AlertDescription>You do not have the privileges to administrate the users!</AlertDescription>
		</Alert>
	{:else if state === 'missing'}
		<Alert variant="destructive" role="alert">
			<AlertDescription>
				The selected user was not found in the privilege table. {error}
			</AlertDescription>
		</Alert>
	{:else}
		<AccountTabs {account} {active} {server} />
		{#if form?.saved}
			<Alert variant="success" role="status" data-testid="privileges-saved">
				<AlertDescription>{form.saved}</AlertDescription>
			</Alert>
		{:else if form?.error}
			<Alert variant="destructive" role="alert" data-testid="privileges-error">
				<AlertDescription>{form.error}</AlertDescription>
			</Alert>
		{/if}
		{#if form?.results}
			<StatementList results={form.results} />
		{/if}
		{@render children()}
	{/if}
</div>
