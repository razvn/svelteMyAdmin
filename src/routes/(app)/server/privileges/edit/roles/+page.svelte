<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import AccountEditShell from '#lib/components/privileges/account-edit-shell.svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { namedAction } from '#lib/nav/account-tabs.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const value = (r: { role?: string; name?: string; host: string | null }) =>
		`${r.role ?? r.name}|${r.host ?? ''}`;
	// svelte-ignore state_referenced_locally
	let defaults = $state<string[]>(
		data.state === 'ok' ? data.granted.filter((g) => g.isDefault).map(value) : []
	);
	let adminOption = $state(false);
	const mariaDb = $derived(data.server.isMariaDB);
	function toggle(v: string, on: boolean) {
		// MariaDB takes one default role only
		defaults = on ? (mariaDb ? [v] : [...defaults, v]) : defaults.filter((d) => d !== v);
	}
</script>

<svelte:head>
	<title>Edit privileges: roles - svelteMyAdmin</title>
</svelte:head>

<AccountEditShell
	account={data.account}
	server={data.server}
	active="roles"
	state={data.state}
	error={data.state === 'missing' ? data.error : ''}
	{form}
>
	{#if data.state === 'ok'}
		<form
			method="POST"
			action={namedAction(page.url.search, 'defaults')}
			use:enhance
			data-testid="roles-form"
		>
			{#each defaults.filter((d) => data.granted.some((g) => value(g) === d)) as d (d)}
				<input type="hidden" name="default" value={d} />
			{/each}
			<Card.Root class="gap-0 py-0">
				<Card.Header class="border-b py-5">
					<Card.Title>Granted roles</Card.Title>
					<Card.Description>
						{mariaDb
							? 'MariaDB activates one default role at login.'
							: 'Default roles are activated automatically at login.'}
					</Card.Description>
				</Card.Header>
				<Card.Content class="px-0">
					<Table.Root data-testid="granted-roles">
						<Table.Header>
							<Table.Row>
								<Table.Head>Role</Table.Head>
								<Table.Head>Admin option</Table.Head>
								<Table.Head>Default</Table.Head>
								<Table.Head class="text-end">Action</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.granted as g (value(g))}
								<Table.Row data-testid="granted-role" data-role={g.role}>
									<Table.Cell class="font-mono text-[13px] font-medium">
										{g.role}{#if g.host}<span class="text-muted-foreground">@{g.host}</span>{/if}
									</Table.Cell>
									<Table.Cell>
										<Badge variant={g.adminOption ? 'success' : 'muted'}>
											{g.adminOption ? 'Yes' : 'No'}
										</Badge>
									</Table.Cell>
									<Table.Cell>
										<Checkbox
											aria-label="Default role {g.role}"
											disabled={!data.isGrantUser}
											checked={defaults.includes(value(g))}
											onCheckedChange={(v) => toggle(value(g), v === true)}
										/>
									</Table.Cell>
									<Table.Cell class="text-end">
										{#if data.isGrantUser}
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												formaction={namedAction(page.url.search, 'revoke')}
												name="role"
												value={value(g)}
												aria-label="Revoke role {g.role}"
											>
												<Undo2 /> Revoke
											</Button>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell colspan={4} class="py-8 text-center text-muted-foreground">
										No roles granted.
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
			{#if data.isGrantUser && data.granted.length > 0}
				<div class="mt-4 flex justify-end">
					<Button type="submit" disabled={!hydration.ready} data-testid="save-defaults">
						Save default roles
					</Button>
				</div>
			{/if}
		</form>

		{#if data.isGrantUser}
			<Card.Root>
				<Card.Header><Card.Title>Grant a role</Card.Title></Card.Header>
				<Card.Content>
					<form
						method="POST"
						action={namedAction(page.url.search, 'grant')}
						class="flex flex-wrap items-center gap-3"
						use:enhance
						data-testid="grant-role-form"
					>
						<NativeSelect name="role" aria-label="Role">
							<NativeSelectOption value="">Select a role</NativeSelectOption>
							{#each data.available as r (value({ name: r.name, host: r.host }))}
								<NativeSelectOption value={value({ name: r.name, host: r.host })}
									>{r.name}{r.host ? `@${r.host}` : ''}</NativeSelectOption
								>
							{/each}
						</NativeSelect>
						<div class="flex items-center gap-2">
							<Checkbox
								id="admin-option"
								aria-label="WITH ADMIN OPTION"
								bind:checked={adminOption}
							/>
							<label for="admin-option" class="text-sm">WITH ADMIN OPTION</label>
							{#if adminOption}<input type="hidden" name="admin_option" value="1" />{/if}
						</div>
						<Button type="submit" disabled={!hydration.ready} data-testid="grant-role-go">
							Grant
						</Button>
					</form>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</AccountEditShell>
