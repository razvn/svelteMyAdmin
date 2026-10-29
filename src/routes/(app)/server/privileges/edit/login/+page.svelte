<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import AccountEditShell from '#lib/components/privileges/account-edit-shell.svelte';
	import PasswordFields from '#lib/components/privileges/password-fields.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { namedAction } from '#lib/nav/account-tabs.ts';
	import { N_, useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t } = useI18n();
	let { data, form }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let plugin = $state(data.state === 'ok' ? data.plugin : '');
	let predPassword = $state('userdefined');
	let pw = $state('');
	let pw2 = $state('');
	let submitting = $state(false);

	const modes = [
		{ value: '4', label: N_('… keep the old one.') },
		{ value: '1', label: N_('… delete the old one from the user tables.') },
		{
			value: '2',
			label: N_('… revoke all active privileges from the old one and delete it afterwards.')
		},
		{
			value: '3',
			label: N_('… delete the old one from the user tables and reload the privileges afterwards.')
		}
	];
</script>

<svelte:head>
	<title>{t('Edit privileges: login information')} - svelteMyAdmin</title>
</svelte:head>

<AccountEditShell
	account={data.account}
	server={data.server}
	active="login"
	state={data.state}
	error={data.state === 'missing' ? data.error : ''}
	{form}
>
	{#if data.state === 'ok'}
		{#if !data.account.noHost}
			<form
				method="POST"
				action={namedAction(page.url.search, 'login')}
				autocomplete="off"
				class="flex flex-col gap-6"
				data-testid="login-form"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update({ reset: false });
						submitting = false;
					};
				}}
			>
				<Card.Root>
					<Card.Header>
						<Card.Title>{t('Change login information / Copy user account')}</Card.Title>
						<Card.Description>
							{t(
								'Leave a field empty to keep the current value. The new account gets the same password, privileges at every level, resource limits, SSL requirements and roles.'
							)}
						</Card.Description>
					</Card.Header>
					<Card.Content class="grid gap-5">
						<div class="grid gap-1.5">
							<label for="login-username" class="text-sm font-medium">{t('User name:')}</label>
							<Input
								id="login-username"
								name="username"
								placeholder={data.account.user || t('User name')}
								maxlength={data.lengths.user}
								spellcheck={false}
								class="max-w-sm"
							/>
						</div>
						<div class="grid gap-1.5">
							<label for="login-hostname" class="text-sm font-medium">{t('Host name:')}</label>
							<Input
								id="login-hostname"
								name="hostname"
								placeholder={data.account.host || t('Host name')}
								maxlength={data.lengths.host}
								spellcheck={false}
								class="max-w-sm"
							/>
						</div>
						<fieldset class="grid gap-3 rounded-lg border p-4">
							<legend class="px-1 text-sm font-semibold">
								{t('Create a new user account with the same privileges and …')}
							</legend>
							{#each modes as m (m.value)}
								<label class="flex items-start gap-2 text-sm">
									<input
										type="radio"
										name="mode"
										value={m.value}
										checked={m.value === '4'}
										class="mt-1"
									/>
									<span>{t(m.label)}</span>
								</label>
							{/each}
						</fieldset>
					</Card.Content>
				</Card.Root>
				{#if data.canCopy}
					<div class="flex justify-end">
						<Button
							type="submit"
							disabled={!hydration.ready || submitting}
							data-testid="change-login-go"
						>
							{t('Go')}
						</Button>
					</div>
				{/if}
			</form>
		{/if}

		{#if !data.account.noHost && data.isGrantUser}
			<form
				method="POST"
				action={namedAction(page.url.search, 'password')}
				autocomplete="off"
				class="flex flex-col gap-6"
				data-testid="password-form"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update({ reset: false });
						submitting = false;
					};
				}}
			>
				<Card.Root>
					<Card.Header><Card.Title>{t('Change password')}</Card.Title></Card.Header>
					<Card.Content class="grid gap-5">
						<NativeSelect
							name="pred_password"
							aria-label={t('Password')}
							bind:value={predPassword}
							class="max-w-xs"
						>
							<NativeSelectOption value="none">{t('No password')}</NativeSelectOption>
							<NativeSelectOption value="userdefined">{t('Use text field')}</NativeSelectOption>
						</NativeSelect>
						<PasswordFields
							bind:password={pw}
							bind:confirm={pw2}
							disabled={predPassword === 'none'}
							userName={data.account.user}
							idPrefix="login-pw"
							label={t('Enter password')}
						/>
						{#if data.plugins.length > 0}
							<div class="grid gap-1.5">
								<label for="login-plugin" class="text-sm font-medium">{t('Authentication plugin')}</label>
								<NativeSelect id="login-plugin" name="authentication_plugin" bind:value={plugin}>
									{#each data.plugins as p (p.name)}
										<NativeSelectOption value={p.name}>{t(p.label)} ({p.name})</NativeSelectOption>
									{/each}
								</NativeSelect>
							</div>
						{/if}
					</Card.Content>
				</Card.Root>
				<div class="flex justify-end">
					<Button
						type="submit"
						disabled={!hydration.ready || submitting}
						data-testid="change-password-go"
					>
						{t('Go')}
					</Button>
				</div>
			</form>
		{/if}

		{#if data.account.noHost}
			<Alert role="status">
				<AlertDescription>
					{t('This is a role. Roles have no login information; rename it by creating a new role.')}
				</AlertDescription>
			</Alert>
		{/if}
	{/if}
</AccountEditShell>
