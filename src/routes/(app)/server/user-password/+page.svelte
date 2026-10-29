<script lang="ts">
	import { enhance } from '$app/forms';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import PasswordFields from '#lib/components/privileges/password-fields.svelte';
	import StatementList from '#lib/components/privileges/statement-list.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pw = $state('');
	let pw2 = $state('');
	let nopass = $state(false);
	let submitting = $state(false);
	// svelte-ignore state_referenced_locally
	let plugin = $state(data.denied ? '' : data.plugin);
</script>

<svelte:head>
	<title>Change password - svelteMyAdmin</title>
</svelte:head>

<div class="flex max-w-2xl flex-col gap-6">
	<PageHeader
		icon={KeyRound}
		title="Change password"
		description={data.denied ? '' : `Account '${data.account.user}'@'${data.account.host}'`}
	/>

	{#if data.denied}
		<Alert variant="destructive" role="alert">
			<AlertDescription>You don't have sufficient privileges to be here right now!</AlertDescription
			>
		</Alert>
	{:else}
		{#if form && 'changed' in form && form.changed}
			<Alert variant="success" role="status" data-testid="password-changed">
				<AlertDescription>
					The password for '{data.account.user}'@'{data.account.host}' was changed successfully.
					{#if form.relogin}You have to log in again with the new password.{/if}
				</AlertDescription>
			</Alert>
		{:else if form && 'error' in form && form.error}
			<Alert variant="destructive" role="alert"
				><AlertDescription>{form.error}</AlertDescription></Alert
			>
		{/if}
		{#if form && 'results' in form && form.results}
			<StatementList results={form.results} />
		{/if}

		<form
			method="POST"
			autocomplete="off"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update({ reset: false });
					pw = '';
					pw2 = '';
					submitting = false;
				};
			}}
		>
			<Card.Root>
				<Card.Content class="grid gap-5">
					<div class="flex items-center gap-2">
						<Checkbox id="nopass" bind:checked={nopass} aria-label="No Password" />
						<label for="nopass" class="text-sm">No Password</label>
						{#if nopass}<input type="hidden" name="nopass" value="1" />{/if}
					</div>
					<PasswordFields
						bind:password={pw}
						bind:confirm={pw2}
						disabled={nopass}
						userName={data.account.user}
						idPrefix="chg"
						label="Password"
					/>
					{#if data.plugins.length > 1}
						<div class="grid gap-1.5">
							<label for="chg-plugin" class="text-sm font-medium">Password Hashing:</label>
							<NativeSelect id="chg-plugin" name="authentication_plugin" bind:value={plugin}>
								{#each data.plugins as p (p.name)}
									<NativeSelectOption value={p.name}>{p.label} ({p.name})</NativeSelectOption>
								{/each}
							</NativeSelect>
						</div>
					{/if}
					<div class="flex justify-end">
						<Button
							type="submit"
							disabled={!hydration.ready || submitting}
							data-testid="change-password-go"
						>
							Go
						</Button>
					</div>
				</Card.Content>
			</Card.Root>
		</form>
	{/if}
</div>
