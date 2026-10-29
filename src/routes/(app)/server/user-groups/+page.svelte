<script lang="ts">
	import { enhance } from '$app/forms';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const LEVEL_TITLES: Record<string, string> = {
		server: 'Server-level tabs',
		db: 'Database-level tabs',
		table: 'Table-level tabs'
	};

	let deleteTarget = $state<string | null>(null);
	let deleteForm = $state<HTMLFormElement>();
	let deleting = $state(false);

	const editing = $derived(data.state === 'ok' ? data.edit : null);
	const adding = $derived(data.state === 'ok' && data.adding);
	const formOpen = $derived(adding || editing !== null);
	const err = $derived(form && 'error' in form ? (form.error as string) : null);
</script>

<svelte:head>
	<title>User groups - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={UsersRound}
		title="User groups"
		description="Restrict the menu tabs available to the members of a group."
	>
		{#snippet actions()}
			<Button variant="outline" href="/server/privileges">Back to user accounts</Button>
			{#if data.state === 'ok'}
				<Button href="/server/user-groups?add" data-testid="add-group">Add user group</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.state === 'disabled'}
		<Alert role="status" data-testid="groups-disabled">
			<AlertTitle>User groups are not available</AlertTitle>
			<AlertDescription>
				The <code>users</code> and <code>usergroups</code> tables of the configuration storage are
				not configured or not reachable.
				<a
					class="text-primary underline"
					href="https://docs.phpmyadmin.net/en/latest/config.html#cfg_Servers_usergroups"
					target="_blank"
					rel="noreferrer">See the documentation</a
				>.
			</AlertDescription>
		</Alert>
	{:else if data.state === 'no-privileges'}
		<Alert variant="destructive" role="alert">
			<AlertTitle>No Privileges</AlertTitle>
			<AlertDescription>You do not have the privileges to manage user groups.</AlertDescription>
		</Alert>
	{:else}
		{#if err}
			<Alert variant="destructive" role="alert"><AlertDescription>{err}</AlertDescription></Alert>
		{/if}
		{#if form && 'saved' in form && form.saved}
			<Alert variant="success" role="status" data-testid="group-saved">
				<AlertDescription>The user group "{form.saved}" was saved.</AlertDescription>
			</Alert>
		{/if}
		{#if form && 'deleted' in form && form.deleted}
			<Alert variant="success" role="status" data-testid="group-deleted">
				<AlertDescription>The user group "{form.deleted}" was deleted.</AlertDescription>
			</Alert>
		{/if}

		{#if formOpen}
			<Card.Root>
				<Card.Header>
					<Card.Title>
						{#if editing}Edit user group: '{editing.name}'{:else}Add user group{/if}
					</Card.Title>
					<Card.Description>User group menu assignments</Card.Description>
				</Card.Header>
				<Card.Content>
					<form method="POST" action="?/save" use:enhance class="flex flex-col gap-5">
						<input type="hidden" name="mode" value={editing ? 'edit' : 'add'} />
						{#if editing}
							<input type="hidden" name="userGroup" value={editing.name} />
						{:else}
							<label class="flex max-w-md flex-col gap-1.5 text-sm font-medium">
								Group name
								<Input
									name="userGroup"
									maxlength={64}
									required
									autocomplete="off"
									placeholder="Group name"
									aria-label="Group name"
								/>
							</label>
						{/if}
						<div class="grid gap-4 md:grid-cols-3">
							{#each data.levelTabs as l (l.level)}
								<fieldset class="rounded-lg border p-4" data-testid="tabs-{l.level}">
									<legend class="px-1 text-sm font-medium">{LEVEL_TITLES[l.level]}</legend>
									<div class="flex flex-col gap-2">
										{#each l.tabs as tab (tab.key)}
											<label class="flex items-center gap-2 text-sm">
												<input
													type="checkbox"
													name={tab.key}
													value="Y"
													checked={editing ? editing.checked.includes(tab.key) : false}
													class="size-4 accent-primary"
												/>
												{tab.label}
											</label>
										{/each}
									</div>
								</fieldset>
							{/each}
						</div>
						<div class="flex gap-2">
							<Button type="submit" data-testid="save-group">Go</Button>
							<Button variant="outline" href="/server/user-groups">Cancel</Button>
						</div>
					</form>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if data.members}
			<Card.Root data-testid="group-members">
				<Card.Header>
					<Card.Title>Users of '{data.members.group}' user group</Card.Title>
				</Card.Header>
				<Card.Content>
					{#if data.members.users.length === 0}
						<p class="text-sm text-muted-foreground">
							No users were found belonging to this user group.
						</p>
					{:else}
						<ol class="list-decimal ps-6 text-sm">
							{#each data.members.users as user (user)}<li>{user}</li>{/each}
						</ol>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root class="gap-0 py-0">
			<Table.Root data-testid="groups-table">
				<Table.Header>
					<Table.Row>
						<Table.Head>User groups</Table.Head>
						<Table.Head>Server level tabs</Table.Head>
						<Table.Head>Database level tabs</Table.Head>
						<Table.Head>Table level tabs</Table.Head>
						<Table.Head class="text-end">Action</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.groups as g (g.name)}
						<Table.Row data-testid="group-row" data-group={g.name}>
							<Table.Cell class="font-medium">{g.name}</Table.Cell>
							{#each g.allowed as names, i (i)}
								<Table.Cell class="max-w-xs text-xs whitespace-normal"
									>{names.join(', ')}</Table.Cell
								>
							{/each}
							<Table.Cell class="text-end">
								<div class="flex justify-end gap-1">
									<Button
										variant="ghost"
										size="icon-sm"
										href="/server/user-groups?users={encodeURIComponent(g.name)}"
										aria-label="View users of {g.name}"
										title="View users"
									>
										<UserCheck />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										href="/server/user-groups?edit={encodeURIComponent(g.name)}"
										aria-label="Edit {g.name}"
										title="Edit"
									>
										<Pencil />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="Delete {g.name}"
										title="Delete"
										onclick={() => (deleteTarget = g.name)}
									>
										<Trash2 />
									</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">
								No user groups found.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Root>
	{/if}
</div>

<AlertDialog.Root
	open={deleteTarget !== null}
	onOpenChange={(open) => {
		if (!open) deleteTarget = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete user group</AlertDialog.Title>
			<AlertDialog.Description>
				Delete the user group "{deleteTarget}"? Its members lose the group and all menu tabs become
				available to them again.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<form
			bind:this={deleteForm}
			method="POST"
			action="?/delete"
			use:enhance={() => {
				deleting = true;
				return async ({ update }) => {
					await update();
					deleting = false;
					deleteTarget = null;
				};
			}}
		>
			<input type="hidden" name="userGroup" value={deleteTarget ?? ''} />
		</form>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				disabled={deleting}
				onclick={(e: MouseEvent) => {
					e.preventDefault();
					deleteForm?.requestSubmit();
				}}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
