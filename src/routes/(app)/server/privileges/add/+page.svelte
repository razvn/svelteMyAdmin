<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- hrefs carry the account query string */
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import LimitsFields from '#lib/components/privileges/limits-fields.svelte';
	import PasswordFields from '#lib/components/privileges/password-fields.svelte';
	import PrivilegeGrid from '#lib/components/privileges/privilege-grid.svelte';
	import SslFields from '#lib/components/privileges/ssl-fields.svelte';
	import StatementList from '#lib/components/privileges/statement-list.svelte';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { accountQuery } from '#lib/nav/account-tabs.ts';
	import { NO_LIMITS, type SslRequirement } from '#lib/sql/privileges/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t } = useI18n();
	let { data, form }: PageProps = $props();

	let predUser = $state('userdefined');
	let username = $state('');
	let predHost = $state('any');
	let customHost = $state('%');
	let predPassword = $state('userdefined');
	let pw = $state('');
	let pw2 = $state('');
	// svelte-ignore state_referenced_locally
	let plugin = $state(data.defaultPlugin);
	let privileges = $state<string[]>([]);
	let grantOption = $state(false);
	let limits = $state({ ...NO_LIMITS });
	let ssl = $state<SslRequirement>({ type: 'NONE' });
	let createDb1 = $state(false);
	let createDb2 = $state(false);
	// svelte-ignore state_referenced_locally
	let createDb3 = $state(data.database !== '');
	let submitting = $state(false);

	const hostText = $derived(
		predHost === 'any'
			? '%'
			: predHost === 'localhost'
				? 'localhost'
				: predHost === 'thishost'
					? data.thisHost
					: predHost === 'hosttable'
						? ''
						: customHost
	);
	const selectedPlugin = $derived(data.plugins.find((p) => p.name === plugin));
	const sha256 = $derived(plugin === 'sha256_password');
	const created = $derived(form && 'created' in form ? form.created : null);
</script>

<svelte:head>
	<title>{t('Add user account')} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={UserPlus}
		title={t('Add user account')}
		description={t('Create a new account with its login information, privileges and limits.')}
	>
		{#snippet actions()}
			<Button variant="outline" href="/server/privileges"><ArrowLeft /> {t('User accounts')}</Button
			>
		{/snippet}
	</PageHeader>

	{#if !data.caps.isCreateUser}
		<Alert variant="destructive" role="alert">
			<AlertTitle>{t('No Privileges')}</AlertTitle>
			<AlertDescription
				>{t('You do not have the privileges to administrate the users!')}</AlertDescription
			>
		</Alert>
	{:else}
		{#if created}
			<Alert variant="success" role="status" data-testid="user-added">
				<AlertTitle>{t('You have added a new user.')}</AlertTitle>
				<AlertDescription class="flex flex-wrap items-center gap-3">
					<span>
						{t("Account '{user}'@'{host}' was created.", {
							user: created.user,
							host: created.host
						})}
					</span>
					{#if data.caps.isGrantUser}
						<a class="font-medium underline" href="/server/privileges/edit?{accountQuery(created)}"
							>{t('Edit privileges')}</a
						>
					{/if}
					<a class="font-medium underline" href="/server/privileges">{t('Back to user accounts')}</a
					>
				</AlertDescription>
			</Alert>
		{:else if form && 'error' in form && form.error}
			<Alert variant="destructive" role="alert" data-testid="add-error">
				<AlertDescription>{form.error}</AlertDescription>
			</Alert>
		{/if}
		{#if form?.results}
			<StatementList results={form.results} />
		{/if}

		{#if !created}
			<form
				method="POST"
				autocomplete="off"
				class="flex flex-col gap-6"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update({ reset: false });
						submitting = false;
					};
				}}
			>
				<Card.Root>
					<Card.Header><Card.Title>{t('Login information')}</Card.Title></Card.Header>
					<Card.Content class="grid gap-5">
						<div class="grid gap-1.5">
							<label for="pred-username" class="text-sm font-medium">{t('User name:')}</label>
							<div class="flex flex-wrap items-center gap-2">
								<NativeSelect
									id="pred-username"
									name="pred_username"
									title={t('User name')}
									bind:value={predUser}
								>
									<NativeSelectOption value="any">{t('Any user')}</NativeSelectOption>
									<NativeSelectOption value="userdefined">{t('Use text field')}</NativeSelectOption>
								</NativeSelect>
								<Input
									id="username"
									name="username"
									aria-label={t('User name')}
									placeholder={t('User name')}
									maxlength={data.lengths.user}
									spellcheck={false}
									disabled={predUser === 'any'}
									required={predUser !== 'any'}
									class="max-w-xs min-w-48 flex-1"
									bind:value={username}
								/>
							</div>
						</div>

						<div class="grid gap-1.5">
							<label for="pred-hostname" class="text-sm font-medium">{t('Host name:')}</label>
							<div class="flex flex-wrap items-center gap-2">
								<NativeSelect
									id="pred-hostname"
									name="pred_hostname"
									title={t('Host name')}
									bind:value={predHost}
								>
									<NativeSelectOption value="any">{t('Any host')}</NativeSelectOption>
									<NativeSelectOption value="localhost">{t('Local')}</NativeSelectOption>
									{#if data.thisHost}
										<NativeSelectOption value="thishost">{t('This host')}</NativeSelectOption>
									{/if}
									<NativeSelectOption value="hosttable">{t('Use host table')}</NativeSelectOption>
									<NativeSelectOption value="userdefined">{t('Use text field')}</NativeSelectOption>
								</NativeSelect>
								<Input
									id="hostname"
									name="hostname"
									aria-label={t('Host name')}
									placeholder={t('Host name')}
									maxlength={data.lengths.host}
									spellcheck={false}
									disabled={predHost !== 'userdefined'}
									required={predHost === 'userdefined'}
									class="max-w-xs min-w-48 flex-1"
									value={hostText}
									oninput={(e) => (customHost = e.currentTarget.value)}
								/>
							</div>
							<p class="text-xs text-muted-foreground">
								{t(
									'When Host table is used, this field is ignored and values stored in Host table are used instead.'
								)}
							</p>
						</div>

						<div class="grid gap-1.5">
							<label for="pred-password" class="text-sm font-medium">{t('Password:')}</label>
							<NativeSelect
								id="pred-password"
								name="pred_password"
								title={t('Password')}
								bind:value={predPassword}
							>
								<NativeSelectOption value="none">{t('No password')}</NativeSelectOption>
								<NativeSelectOption value="userdefined">{t('Use text field')}</NativeSelectOption>
							</NativeSelect>
						</div>
						<PasswordFields
							bind:password={pw}
							bind:confirm={pw2}
							disabled={predPassword === 'none'}
							userName={username}
							idPrefix="add-pw"
							label={t('Enter password')}
						/>

						{#if data.plugins.length > 0}
							<div class="grid gap-1.5">
								<label for="auth-plugin" class="text-sm font-medium"
									>{t('Authentication plugin')}</label
								>
								<NativeSelect id="auth-plugin" name="authentication_plugin" bind:value={plugin}>
									{#each data.plugins as p (p.name)}
										<NativeSelectOption value={p.name}>{t(p.label)} ({p.name})</NativeSelectOption>
									{/each}
								</NativeSelect>
								{#if selectedPlugin?.passwordless}
									<p class="text-xs text-muted-foreground">
										{t('This plugin does not use a password; the password fields are ignored.')}
									</p>
								{/if}
								{#if sha256}
									<Alert variant="info" class="mt-1">
										<AlertDescription>
											{t(
												'This method requires using an SSL connection or an unencrypted connection that encrypts the password using RSA while connecting to the server.'
											)}
										</AlertDescription>
									</Alert>
								{/if}
							</div>
						{/if}
					</Card.Content>
				</Card.Root>

				{#if data.caps.isGrantUser}
					<Card.Root>
						<Card.Header><Card.Title>{t('Database for user account')}</Card.Title></Card.Header>
						<Card.Content class="grid gap-3">
							<div class="flex items-center gap-2">
								<Checkbox
									id="createdb-1"
									bind:checked={createDb1}
									aria-label={t('Create database with same name and grant all privileges.')}
								/>
								<label for="createdb-1" class="text-sm">
									{t('Create database with same name and grant all privileges.')}
								</label>
								{#if createDb1}<input type="hidden" name="createdb-1" value="on" />{/if}
							</div>
							<div class="flex items-center gap-2">
								<Checkbox
									id="createdb-2"
									bind:checked={createDb2}
									aria-label={t('Grant all privileges on wildcard name (username\\_%).')}
								/>
								<label for="createdb-2" class="text-sm">
									{t('Grant all privileges on wildcard name (username\\_%).')}
								</label>
								{#if createDb2}<input type="hidden" name="createdb-2" value="on" />{/if}
							</div>
							{#if data.database}
								<div class="flex items-center gap-2">
									<Checkbox
										id="createdb-3"
										bind:checked={createDb3}
										aria-label={t('Grant all privileges on database {db}.', { db: data.database })}
									/>
									<label for="createdb-3" class="text-sm">
										{t('Grant all privileges on database {db}.', { db: data.database })}
									</label>
									{#if createDb3}<input type="hidden" name="createdb-3" value="on" />{/if}
									<input type="hidden" name="dbname" value={data.database} />
								</div>
							{/if}
						</Card.Content>
					</Card.Root>

					<Card.Root>
						<Card.Header><Card.Title>{t('Global privileges')}</Card.Title></Card.Header>
						<Card.Content>
							<PrivilegeGrid
								scope="global"
								server={data.server}
								bind:selected={privileges}
								bind:grantOption
								idPrefix="priv"
							/>
						</Card.Content>
					</Card.Root>
				{/if}

				<Card.Root>
					<Card.Header><Card.Title>{t('Resource limits')}</Card.Title></Card.Header>
					<Card.Content><LimitsFields bind:limits /></Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header><Card.Title>{t('SSL')}</Card.Title></Card.Header>
					<Card.Content><SslFields bind:ssl /></Card.Content>
				</Card.Root>

				<div class="flex justify-end gap-2">
					<Button variant="outline" href="/server/privileges">{t('Cancel')}</Button>
					<Button type="submit" disabled={!hydration.ready || submitting} data-testid="add-user-go">
						{t('Go')}
					</Button>
				</div>
			</form>
		{/if}
	{/if}
</div>
