<script lang="ts">
	import AccountEditShell from '#lib/components/privileges/account-edit-shell.svelte';
	import GrantList, { type GrantRow } from '#lib/components/privileges/grant-list.svelte';
	import ScopedEditor from '#lib/components/privileges/scoped-editor.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import { accountQuery } from '#lib/nav/account-tabs.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t } = useI18n();
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
	<title>{t('Edit privileges: routine')} - svelteMyAdmin</title>
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
				<Card.Title>{t('Database')}</Card.Title>
				<Card.Description>{t('Choose the database whose routines you want to edit.')}</Card.Description>
			</Card.Header>
			<Card.Content>
				<form method="GET" class="flex flex-wrap items-center gap-2" data-testid="choose-database">
					<input type="hidden" name="username" value={data.account.user} />
					<input type="hidden" name="hostname" value={data.account.host} />
					<NativeSelect name="dbname" aria-label={t('Database')} value={data.dbname}>
						<NativeSelectOption value="">{t('Select a database')}</NativeSelectOption>
						{#each data.databases as db (db)}
							<NativeSelectOption value={db}>{db}</NativeSelectOption>
						{/each}
					</NativeSelect>
					<Button type="submit" variant="outline">{t('Go')}</Button>
				</form>
			</Card.Content>
		</Card.Root>

		{#if data.dbname}
			<GrantList
				title={t('Routine-specific privileges in {db}', { db: data.dbname })}
				headings={[t('Routine'), t('Type')]}
				{rows}
				canEdit={data.isGrantUser}
				empty={t('No routine-specific privileges in this database.')}
				testid="routine-grants"
			/>

			{#if data.isGrantUser}
				<Card.Root>
					<Card.Header>
						<Card.Title>{t('Add privileges on the following routine')}</Card.Title>
					</Card.Header>
					<Card.Content>
						<form method="GET" class="flex flex-wrap items-center gap-2">
							<input type="hidden" name="username" value={data.account.user} />
							<input type="hidden" name="hostname" value={data.account.host} />
							<input type="hidden" name="dbname" value={data.dbname} />
							<NativeSelect
								name="routine"
								aria-label={t('Routine')}
								value={data.picked ? `${data.picked.type}|${data.picked.name}` : ''}
							>
								<NativeSelectOption value="">{t('Select a routine')}</NativeSelectOption>
								{#each data.routines as r (r.type + r.name)}
									<NativeSelectOption value="{r.type}|{r.name}"
										>{r.name} ({r.type.toLowerCase()})</NativeSelectOption
									>
								{/each}
							</NativeSelect>
							<Button type="submit" data-testid="choose-routine-go">{t('Go')}</Button>
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
					title={t('Routine-specific privileges on {target}', {
						target: `${data.picked.type} ${data.dbname}.${data.picked.name}`
					})}
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
