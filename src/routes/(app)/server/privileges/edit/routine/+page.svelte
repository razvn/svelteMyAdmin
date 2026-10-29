<script lang="ts">
	import AccountEditShell from '#lib/components/privileges/account-edit-shell.svelte';
	import GrantList, { type GrantRow } from '#lib/components/privileges/grant-list.svelte';
	import ScopedEditor from '#lib/components/privileges/scoped-editor.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import { accountQuery } from '#lib/nav/account-tabs.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const query = $derived(accountQuery(data.account));
	const rows = $derived<GrantRow[]>(
		data.state === 'ok'
			? data.rows.map((r) => ({
					name: r.routine,
					detail: r.type,
					summary: r.summary,
					grantOption: r.grantOption,
					editHref: `/server/privileges/edit/routine?${query}&${new URLSearchParams({ dbname: data.dbname, routine: `${r.type}|${r.routine}` })}`,
					fields: { dbname: data.dbname, routine: `${r.type}|${r.routine}` }
				}))
			: []
	);
</script>

<svelte:head>
	<title>Edit privileges: routine - svelteMyAdmin</title>
</svelte:head>

<AccountEditShell
	account={data.account}
	server={data.server}
	active="routine"
	state={data.state}
	error={data.state === 'missing' ? data.error : ''}
	{form}
>
	{#if data.state === 'ok'}
		<Card.Root>
			<Card.Header>
				<Card.Title>Database</Card.Title>
				<Card.Description>Choose the database whose routines you want to edit.</Card.Description>
			</Card.Header>
			<Card.Content>
				<form method="GET" class="flex flex-wrap items-center gap-2" data-testid="choose-database">
					<input type="hidden" name="username" value={data.account.user} />
					<input type="hidden" name="hostname" value={data.account.host} />
					<NativeSelect name="dbname" aria-label="Database" value={data.dbname}>
						<NativeSelectOption value="">Select a database</NativeSelectOption>
						{#each data.databases as db (db)}
							<NativeSelectOption value={db}>{db}</NativeSelectOption>
						{/each}
					</NativeSelect>
					<Button type="submit" variant="outline">Go</Button>
				</form>
			</Card.Content>
		</Card.Root>

		{#if data.dbname}
			<GrantList
				title="Routine-specific privileges in {data.dbname}"
				headings={['Routine', 'Type']}
				{rows}
				canEdit={data.isGrantUser}
				empty="No routine-specific privileges in this database."
				testid="routine-grants"
			/>

			{#if data.isGrantUser}
				<Card.Root>
					<Card.Header>
						<Card.Title>Add privileges on the following routine</Card.Title>
					</Card.Header>
					<Card.Content>
						<form method="GET" class="flex flex-wrap items-center gap-2">
							<input type="hidden" name="username" value={data.account.user} />
							<input type="hidden" name="hostname" value={data.account.host} />
							<input type="hidden" name="dbname" value={data.dbname} />
							<NativeSelect
								name="routine"
								aria-label="Routine"
								value={data.picked ? `${data.picked.type}|${data.picked.name}` : ''}
							>
								<NativeSelectOption value="">Select a routine</NativeSelectOption>
								{#each data.routines as r (r.type + r.name)}
									<NativeSelectOption value="{r.type}|{r.name}"
										>{r.name} ({r.type.toLowerCase()})</NativeSelectOption
									>
								{/each}
							</NativeSelect>
							<Button type="submit" data-testid="choose-routine-go">Go</Button>
						</form>
					</Card.Content>
				</Card.Root>
			{/if}
		{/if}

		{#if data.picked && data.initial}
			{#key JSON.stringify([data.dbname, data.picked, data.initial])}
				<ScopedEditor
					server={data.server}
					scope="routine"
					title="Routine-specific privileges on {data.picked.type} {data.dbname}.{data.picked.name}"
					initial={data.initial}
					canEdit={data.isGrantUser}
					hidden={{
						dbname: [data.dbname],
						routine: [`${data.picked.type}|${data.picked.name}`]
					}}
				/>
			{/key}
		{/if}
	{/if}
</AccountEditShell>
