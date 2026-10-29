<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import AccountTabs from '#lib/components/privileges/account-tabs.svelte';
	import GlobalEditor from '#lib/components/privileges/global-editor.svelte';
	import StatementList from '#lib/components/privileges/statement-list.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const title = $derived(`'${data.account.user}'@'${data.account.host}'`);
</script>

<svelte:head>
	<title>Edit privileges - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader icon={UserCog} title="Edit privileges: User account {title}">
		{#snippet actions()}
			<Button variant="outline" href="/server/privileges"><ArrowLeft /> User accounts</Button>
		{/snippet}
	</PageHeader>

	{#if data.state === 'denied'}
		<Alert variant="destructive" role="alert">
			<AlertDescription>You do not have the privileges to administrate the users!</AlertDescription>
		</Alert>
	{:else if data.state === 'missing'}
		<Alert variant="destructive" role="alert">
			<AlertDescription>
				The selected user was not found in the privilege table. {data.error}
			</AlertDescription>
		</Alert>
	{:else}
		<AccountTabs account={data.account} active="global" server={data.server} />
		{#if data.isSelf}
			<Alert role="status">
				<AlertDescription>
					Note: You are attempting to edit privileges of the user with which you are currently
					logged in.
				</AlertDescription>
			</Alert>
		{/if}
		{#if form && 'saved' in form && form.saved}
			<Alert variant="success" role="status" data-testid="privileges-saved">
				<AlertDescription>You have updated the privileges for {title}.</AlertDescription>
			</Alert>
		{:else if form && 'error' in form && form.error}
			<Alert variant="destructive" role="alert"
				><AlertDescription>{form.error}</AlertDescription></Alert
			>
		{/if}
		{#if form?.results}
			<StatementList results={form.results} />
		{/if}
		{#key JSON.stringify(data.initial)}
			<GlobalEditor server={data.server} initial={data.initial} canEdit={data.isGrantUser} />
		{/key}
	{/if}
</div>
