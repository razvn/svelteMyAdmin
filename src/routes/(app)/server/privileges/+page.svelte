<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- hrefs carry the account query string */
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { SvelteURL } from 'svelte/reactivity';
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import Lock from '@lucide/svelte/icons/lock';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Users from '@lucide/svelte/icons/users';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import RolesSection from '#lib/components/privileges/roles-section.svelte';
	import StatementList from '#lib/components/privileges/statement-list.svelte';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { accountQuery } from '#lib/nav/account-tabs.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t, tn } = useI18n();
	let { data, form }: PageProps = $props();

	let filter = $state('');
	let selected = $state<string[]>([]);
	let dropDatabases = $state(false);
	let confirmOpen = $state(false);
	let dropping = $state(false);
	let dropForm = $state<HTMLFormElement>();
	let exportClosedFor = $state<unknown>(null);
	let groupDialog = $state<{ username: string; group: string } | null>(null);
	let savingGroup = $state(false);

	function openGroupDialog(username: string, group: string) {
		groupDialog = { username, group };
	}

	const accounts = $derived(data.state === 'ok' ? data.accounts : []);
	const visible = $derived(
		accounts.filter((a) => {
			const q = filter.trim().toLowerCase();
			return q === '' || a.user.toLowerCase().includes(q) || a.host.toLowerCase().includes(q);
		})
	);
	const allChecked = $derived(
		visible.length > 0 && visible.every((a) => selected.includes(a.value))
	);
	const chosen = $derived(accounts.filter((a) => selected.includes(a.value)));
	const exportText = $derived(form && 'exportText' in form ? (form.exportText as string) : null);
	const exportOpen = $derived(exportText !== null && exportClosedFor !== form);

	function toggleAll(on: boolean) {
		const values = visible.map((a) => a.value);
		selected = on
			? [...new Set([...selected, ...values])]
			: selected.filter((v) => !values.includes(v));
	}
	function toggle(value: string, on: boolean) {
		selected = on ? [...selected, value] : selected.filter((v) => v !== value);
	}
	function editHref(a: { user: string; host: string }): string {
		return `/server/privileges/edit?${accountQuery(a)}`;
	}
	function initialHref(initial: string | null): string {
		const u = new SvelteURL(page.url.href);
		u.search = '';
		if (initial !== null) u.searchParams.set('initial', initial);
		else u.searchParams.set('showall', '1');
		return u.pathname + u.search;
	}
	async function copyExport() {
		if (exportText === null) return;
		try {
			await navigator.clipboard.writeText(exportText);
			toast.success(t('Copied to the clipboard.'));
		} catch {
			toast.error(t('Could not copy to the clipboard.'));
		}
	}
</script>

<svelte:head>
	<title>{t('User accounts')} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Users}
		title={t('User accounts')}
		description={data.state === 'ok'
			? tn(
					'{n} user account on this server.',
					'{n} user accounts on this server.',
					data.total
				)
			: t('Users and privileges.')}
	>
		{#snippet actions()}
			{#if data.state === 'ok' && data.userGroups && data.caps.isSuperUser}
				<Button variant="outline" href="/server/user-groups" data-testid="user-groups-link">
					<UsersRound />
					{t('User groups')}
				</Button>
			{/if}
			{#if data.caps.isCreateUser}
				<Button href="/server/privileges/add" data-testid="add-user">
					<UserPlus />
					{t('Add user account')}
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.state === 'no-privileges'}
		<Alert variant="destructive" role="alert">
			<AlertTitle>{t('No Privileges')}</AlertTitle>
			<AlertDescription
				>{t('You do not have the privileges to view or administrate user accounts.')}</AlertDescription
			>
		</Alert>
	{:else}
		{#if !data.caps.isGrantUser && !data.caps.isCreateUser}
			<Alert role="status">
				<AlertDescription
					>{t('You do not have the privileges to administrate the users!')}</AlertDescription
				>
			</Alert>
		{/if}

		{#if data.state === 'cannot-view'}
			<Alert variant="destructive" role="alert">
				<AlertTitle>{t('Not enough privilege to view users.')}</AlertTitle>
				<AlertDescription>
					{t('Your account cannot read the privilege tables.')}
					{#if data.caps.isCreateUser}{t('You can still add a user account.')}{/if}
				</AlertDescription>
			</Alert>
		{:else}
			{#if data.anonymousLocalhost}
				<Alert variant="warning" role="status" data-testid="anonymous-warning">
					<AlertDescription>
						{t(
							'A user account allowing any user from localhost to connect is present. This will prevent other users from connecting if the host part of their account allows a connection from any (%) host.'
						)}
					</AlertDescription>
				</Alert>
			{/if}

			{#if form && 'drop' in form && form.drop}
				{#if form.drop.error}
					<Alert variant="destructive" role="alert"
						><AlertDescription>{form.drop.error}</AlertDescription></Alert
					>
				{/if}
				<StatementList results={form.drop.results} title={t('Removed user accounts')} />
			{/if}
			{#if form && 'groupError' in form && form.groupError}
				<Alert variant="destructive" role="alert"
					><AlertDescription>{form.groupError}</AlertDescription></Alert
				>
			{/if}
			{#if form && 'exportError' in form && form.exportError}
				<Alert variant="destructive" role="alert"
					><AlertDescription>{form.exportError}</AlertDescription></Alert
				>
			{/if}
			{#if form && 'flushError' in form && form.flushError}
				<Alert variant="destructive" role="alert"
					><AlertDescription>{form.flushError}</AlertDescription></Alert
				>
			{/if}
			{#if form && 'flushed' in form && form.flushed}
				<Alert variant="success" role="status">
					<AlertDescription>{t('The privileges were reloaded successfully.')}</AlertDescription>
				</Alert>
			{/if}

			{#if data.initials.length > 0}
				<nav aria-label={t('Pagination of user accounts')} class="flex flex-wrap items-center gap-1">
					{#each data.initials as initial (initial)}
						<Button
							variant={data.initial === initial ? 'default' : 'outline'}
							size="sm"
							href={initialHref(initial)}
							aria-current={data.initial === initial ? 'page' : undefined}
							class="min-w-8"
						>
							{#if initial === ''}<span class="text-destructive">{t('Any')}</span>{:else}{initial}{/if}
						</Button>
					{/each}
					<Button variant={data.showAll ? 'default' : 'outline'} size="sm" href={initialHref(null)}>
						{t('Show all')}
					</Button>
				</nav>
			{/if}

			{#if data.tooMany}
				<Alert role="status">
					<AlertDescription>
						{t('There are {n} user accounts. Choose an initial letter or "Show all" to list them.', {
							n: data.total
						})}
					</AlertDescription>
				</Alert>
			{:else}
				<Card.Root class="gap-0 py-0">
					<form
						bind:this={dropForm}
						method="POST"
						action="?/drop"
						id="usersForm"
						use:enhance={() => {
							dropping = true;
							return async ({ result, update }) => {
								if (result.type === 'success') {
									toast.success(t('The selected users have been deleted successfully.'));
									selected = [];
								}
								await update({ reset: false });
								dropping = false;
								confirmOpen = false;
							};
						}}
					>
						{#each selected as value (value)}
							<input type="hidden" name="selected_usr" {value} />
						{/each}
						{#if dropDatabases}<input type="hidden" name="drop_users_db" value="on" />{/if}

						<div class="flex flex-wrap items-center gap-2 border-b p-5">
							<div class="flex items-center gap-2">
								<Checkbox
									id="check-all"
									checked={allChecked}
									onCheckedChange={(v) => toggleAll(v === true)}
									aria-label={t('Check all')}
								/>
								<label for="check-all" class="text-sm">{t('Check all')}</label>
							</div>
							<Button
								variant="outline"
								size="sm"
								type="submit"
								formaction="?/export"
								disabled={selected.length === 0}
								data-testid="export-selected"
							>
								<Download />
								{t('Export')}
							</Button>
							<div class="relative ms-auto w-56">
								<Search
									class="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									bind:value={filter}
									type="search"
									placeholder={t('Search')}
									aria-label={t('Search')}
									class="ps-8"
								/>
							</div>
						</div>

						<Table.Root data-testid="accounts-table">
							<Table.Header>
								<Table.Row>
									<Table.Head class="w-8"></Table.Head>
									<Table.Head>{t('User name')}</Table.Head>
									<Table.Head>{t('Host name')}</Table.Head>
									<Table.Head>{t('Password')}</Table.Head>
									<Table.Head title={t('Note: MySQL privilege names are expressed in English.')}>
										{t('Global privileges')}
									</Table.Head>
									<Table.Head>{t('User group')}</Table.Head>
									<Table.Head>{t('Grant')}</Table.Head>
									<Table.Head class="text-end">{t('Action')}</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each visible as a (a.value)}
									<Table.Row data-testid="account-row" data-user={a.user} data-host={a.host}>
										<Table.Cell>
											<Checkbox
												checked={selected.includes(a.value)}
												onCheckedChange={(v) => toggle(a.value, v === true)}
												aria-label={t('Select {account}', { account: `${a.user || t('Any')}@${a.host}` })}
											/>
										</Table.Cell>
										<Table.Cell class="font-medium">
											{#if a.user === ''}
												<span class="text-destructive">{t('Any')}</span>
											{:else if data.caps.isGrantUser}
												<a
													href={editHref(a)}
													class="text-foreground hover:text-primary hover:underline"
												>
													{a.user}
												</a>
											{:else}
												{a.user}
											{/if}
											{#if a.locked}
												<Badge variant="warning" class="ms-2"><Lock />
													{t('Locked')}</Badge
												>
											{/if}
										</Table.Cell>
										<Table.Cell class="font-mono text-[13px]">{a.host}</Table.Cell>
										<Table.Cell>
											{#if a.hasPassword}
												<Badge variant="success">{t('Yes')}</Badge>
											{:else}
												<Badge variant="destructive">{t('No')}</Badge>
											{/if}
											{#if !a.inUserTable}
												<span
													class="ms-1 text-xs text-muted-foreground"
													title={t('The selected user was not found in the privilege table.')}
													>{t('(not in user table)')}</span
												>
											{/if}
										</Table.Cell>
										<Table.Cell class="max-w-md whitespace-normal">
											<code class="font-mono text-xs break-words" data-testid="global-privileges"
												>{a.summary.items.join(', ')}</code
											>
											{#if a.summary.dynamic.length > 0}
												<Badge variant="muted" class="ms-1" title={a.summary.dynamic.join(', ')}
													>{a.summary.kind === 'all' ? '+ ' : ''}{t('{n} dynamic', { n: a.summary.dynamic.length })}</Badge
												>
											{/if}
										</Table.Cell>
										<Table.Cell data-testid="user-group-cell">
											{#if data.userGroups}
												<span class={a.userGroup ? '' : 'text-muted-foreground'}
													>{a.userGroup || '-'}</span
												>
												{#if a.user !== ''}
													<Button
														variant="ghost"
														size="icon-sm"
														aria-label={t('Edit user group of {name}', { name: a.user })}
														title={t('Edit user group')}
														onclick={() => openGroupDialog(a.user, a.userGroup)}
													>
														<UsersRound />
													</Button>
												{/if}
											{:else}
												<span class="text-muted-foreground">-</span>
											{/if}
										</Table.Cell>
										<Table.Cell>{a.hasGrant ? t('Yes') : t('No')}</Table.Cell>
										<Table.Cell class="text-end">
											<div class="flex justify-end gap-1">
												{#if data.caps.isGrantUser}
													<Button
														variant="ghost"
														size="icon-sm"
														href={editHref(a)}
														aria-label={t('Edit privileges of {account}', { account: `${a.user || t('Any')}@${a.host}` })}
														title={t('Edit privileges')}
													>
														<Pencil />
													</Button>
												{/if}
												<Button
													variant="ghost"
													size="icon-sm"
													type="submit"
													formaction="?/export"
													name="only"
													value={a.value}
													aria-label={t('Export {account}', { account: `${a.user || t('Any')}@${a.host}` })}
													title={t('Export')}
												>
													<Download />
												</Button>
											</div>
										</Table.Cell>
									</Table.Row>
								{:else}
									<Table.Row>
										<Table.Cell colspan={8} class="py-8 text-center text-muted-foreground">
											{t('No user accounts found.')}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</form>
				</Card.Root>

				{#if data.caps.isCreateUser}
					<Card.Root>
						<Card.Header>
							<Card.Title class="flex items-center gap-2">
								<Trash2 class="size-4 text-destructive" />
								{t('Remove selected user accounts')}
							</Card.Title>
							<Card.Description>
								{t('Revoke all active privileges from the users and delete them afterwards.')}
							</Card.Description>
						</Card.Header>
						<Card.Content class="flex flex-wrap items-center gap-4">
							<div class="flex items-center gap-2">
								<Checkbox
									id="drop-users-db"
									bind:checked={dropDatabases}
									aria-label={t('Drop the databases that have the same names as the users.')}
								/>
								<label for="drop-users-db" class="text-sm">
									{t('Drop the databases that have the same names as the users.')}
								</label>
							</div>
							<Button
								variant="destructive"
								disabled={selected.length === 0 || !hydration.ready}
								onclick={() => (confirmOpen = true)}
								data-testid="remove-selected"
							>
								{t('Go')}
							</Button>
						</Card.Content>
					</Card.Root>
				{/if}
			{/if}

			{#if data.rolesSupported}
				<RolesSection
					roles={data.roles}
					canManage={data.caps.isCreateUser}
					result={form && 'roleResult' in form ? form.roleResult : null}
				/>
			{/if}

			<Alert>
				<AlertDescription class="flex flex-wrap items-center gap-2">
					{t(
						"Note: svelteMyAdmin gets the users' privileges directly from MySQL's privilege tables. The content of these tables may differ from the privileges the server uses, if they have been changed manually."
					)}
					{#if data.caps.canReload}
						{t('In this case, you should reload the privileges before you continue.')}
						<form method="POST" action="?/flush" use:enhance class="contents">
							<Button type="submit" variant="outline" size="sm" data-testid="flush-privileges">
								<RefreshCw />
								{t('Reload privileges')}
							</Button>
						</form>
					{:else}
						{t(
							"In this case, the privileges have to be reloaded but currently, you don't have the RELOAD privilege."
						)}
					{/if}
				</AlertDescription>
			</Alert>
		{/if}
	{/if}
</div>

<Dialog.Root
	open={exportOpen}
	onOpenChange={(open) => {
		if (!open) exportClosedFor = form;
	}}
>
	<Dialog.Content class="sm:max-w-3xl" data-testid="export-dialog">
		<Dialog.Header>
			<Dialog.Title>{t('Privileges')}</Dialog.Title>
			<Dialog.Description>{t('SHOW GRANTS of the selected user accounts.')}</Dialog.Description>
		</Dialog.Header>
		<textarea
			readonly
			rows="14"
			aria-label={t('Exported privileges')}
			data-testid="export-text"
			class="w-full rounded-lg border bg-muted/40 p-3 font-mono text-xs"
			value={exportText ?? ''}></textarea>
		<Dialog.Footer>
			<Button variant="outline" onclick={copyExport}><Copy /> {t('Copy')}</Button>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props}>{t('Close')}</Button>
				{/snippet}
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{t('Remove selected user accounts')}</AlertDialog.Title>
			<AlertDialog.Description>
				{t('The privileges of these accounts are revoked and the accounts are deleted.')}
				{#if dropDatabases}{t('The databases with the same names as the users are dropped too.')}{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<ul class="max-h-48 list-disc overflow-auto ps-6 text-sm" data-testid="drop-list">
			{#each chosen as a (a.value)}
				<li class="font-mono">'{a.user}'@'{a.host}'</li>
			{/each}
		</ul>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{t('Cancel')}</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				disabled={dropping}
				onclick={(e: MouseEvent) => {
					e.preventDefault();
					dropForm?.requestSubmit();
				}}
			>
				{t('Drop')}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root
	open={groupDialog !== null}
	onOpenChange={(open) => {
		if (!open) groupDialog = null;
	}}
>
	<Dialog.Content data-testid="group-dialog">
		<Dialog.Header>
			<Dialog.Title>{t('Edit user group')}</Dialog.Title>
			<Dialog.Description>
				{t("User group of '{name}'. Its menu restrictions apply to this user.", {
					name: groupDialog?.username ?? ''
				})}
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/setGroup"
			class="flex flex-col gap-4"
			use:enhance={() => {
				savingGroup = true;
				return async ({ result, update }) => {
					await update();
					savingGroup = false;
					if (result.type === 'success') {
						toast.success(t('The user group was updated.'));
						groupDialog = null;
					}
				};
			}}
		>
			<input type="hidden" name="username" value={groupDialog?.username ?? ''} />
			<NativeSelect name="usergroup" value={groupDialog?.group ?? ''} aria-label={t('User group')}>
				<NativeSelectOption value="">{t('(no group)')}</NativeSelectOption>
				{#each data.state === 'ok' && data.userGroups ? data.userGroups.groups : [] as g (g)}
					<NativeSelectOption value={g}>{g}</NativeSelectOption>
				{/each}
			</NativeSelect>
			<Dialog.Footer>
				<Button type="submit" disabled={savingGroup} data-testid="group-dialog-go">{t('Go')}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
