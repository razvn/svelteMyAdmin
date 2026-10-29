<script lang="ts">
	import AccountEditShell from '#lib/components/privileges/account-edit-shell.svelte';
	import GrantList, { type GrantRow } from '#lib/components/privileges/grant-list.svelte';
	import ScopedEditor from '#lib/components/privileges/scoped-editor.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { accountQuery } from '#lib/nav/account-tabs.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t } = useI18n();
	let { data, form }: PageProps = $props();

	const query = $derived(accountQuery(data.account));
	const rows = $derived<GrantRow[]>(
		data.state === 'ok'
			? data.rows.map((r) => ({
					name: r.db,
					summary: r.summary,
					grantOption: r.grantOption,
					editHref: `/server/privileges/edit/database?${query}&${new URLSearchParams({ dbname: r.db })}`,
					fields: { dbname: r.db }
				}))
			: []
	);
</script>

<svelte:head>
	<title>{t('Edit privileges: database')} - svelteMyAdmin</title>
</svelte:head>

<AccountEditShell
	account={data.account}
	server={data.server}
	active="database"
	state={data.state}
	error={data.state === 'missing' ? data.error : ''}
	{form}
>
	{#if data.state === 'ok'}
		<GrantList
			title={t('Database-specific privileges')}
			headings={[t('Database')]}
			{rows}
			canEdit={data.isGrantUser}
			empty={t('No database-specific privileges.')}
			testid="database-grants"
		/>

		{#if data.isGrantUser}
			<Card.Root>
				<Card.Header>
					<Card.Title>{t('Add privileges on the following database(s)')}</Card.Title>
					<Card.Description>
						{t(
							'Pick existing databases, and/or type a name with wildcards (_ and %; escape them with \\ to match literally).'
						)}
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<form method="GET" class="grid gap-4" data-testid="add-database-form">
						<input type="hidden" name="username" value={data.account.user} />
						<input type="hidden" name="hostname" value={data.account.host} />
						<div class="grid gap-1.5">
							<label for="dbpick" class="text-sm font-medium">{t('Databases')}</label>
							<select
								id="dbpick"
								name="dbpick"
								multiple
								size="6"
								class="w-full max-w-sm rounded-lg border border-input bg-background p-2 font-mono text-sm"
							>
								{#each data.databases as db (db)}
									<option value={db}>{db}</option>
								{/each}
							</select>
						</div>
						<div class="grid gap-1.5">
							<label for="dbwild" class="text-sm font-medium"
								>{t('Use text field (wildcards allowed)')}</label
							>
							<Input
								id="dbwild"
								name="dbwild"
								placeholder={t('e.g. app\\_%')}
								spellcheck={false}
								class="max-w-sm"
							/>
						</div>
						<div>
							<Button type="submit" data-testid="add-database-go">{t('Go')}</Button>
						</div>
					</form>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if data.editing.length > 0}
			{#key JSON.stringify([data.editing, data.initial])}
				<ScopedEditor
					server={data.server}
					scope="database"
					title={t('Database-specific privileges on {target}', { target: data.editing.join(', ') })}
					initial={data.initial}
					canEdit={data.isGrantUser}
					hidden={{ dbname: data.editing }}
				/>
			{/key}
		{/if}
	{/if}
</AccountEditShell>
