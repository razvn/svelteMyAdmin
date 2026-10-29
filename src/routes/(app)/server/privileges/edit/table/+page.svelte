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
					name: r.table,
					summary: r.summary,
					grantOption: r.grantOption,
					editHref: `/server/privileges/edit/table?${query}&${new URLSearchParams({ dbname: data.dbname, tablename: r.table })}`,
					fields: { dbname: data.dbname, tablename: r.table }
				}))
			: []
	);
</script>

<svelte:head>
	<title>{t('Edit privileges: table')} - svelteMyAdmin</title>
</svelte:head>

<AccountEditShell
	account={data.account}
	server={data.server}
	active="table"
	state={data.state}
	error={data.state === 'missing' ? data.error : ''}
	{form}
>
	{#if data.state === 'ok'}
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Database')}</Card.Title>
				<Card.Description
					>{t('Choose the database whose tables you want to edit.')}</Card.Description
				>
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
				title={t('Table-specific privileges in {db}', { db: data.dbname })}
				headings={[t('Table')]}
				{rows}
				canEdit={data.isGrantUser}
				empty={t('No table-specific privileges in this database.')}
				testid="table-grants"
			/>

			{#if data.isGrantUser}
				<Card.Root>
					<Card.Header
						><Card.Title>{t('Add privileges on the following table')}</Card.Title></Card.Header
					>
					<Card.Content>
						<form method="GET" class="flex flex-wrap items-center gap-2" data-testid="choose-table">
							<input type="hidden" name="username" value={data.account.user} />
							<input type="hidden" name="hostname" value={data.account.host} />
							<input type="hidden" name="dbname" value={data.dbname} />
							<NativeSelect name="tablename" aria-label={t('Table')} value={data.tablename}>
								<NativeSelectOption value="">{t('Select a table')}</NativeSelectOption>
								{#each data.tables as tbl (tbl)}
									<NativeSelectOption value={tbl}>{tbl}</NativeSelectOption>
								{/each}
							</NativeSelect>
							<Button type="submit" data-testid="choose-table-go">{t('Go')}</Button>
						</form>
					</Card.Content>
				</Card.Root>
			{/if}
		{/if}

		{#if data.editing}
			{@const editing = data.editing}
			{#key JSON.stringify( [data.dbname, data.tablename, editing.initial, editing.columnPrivileges] )}
				<ScopedEditor
					server={data.server}
					scope="table"
					title={t('Table-specific privileges on {target}', {
						target: `${data.dbname}.${data.tablename}`
					})}
					initial={editing.initial}
					canEdit={data.isGrantUser}
					hidden={{ dbname: [data.dbname], tablename: [data.tablename] }}
				>
					{#snippet extra()}
						<Card.Root id="column-privileges">
							<Card.Header>
								<Card.Title>{t('Column-specific privileges')}</Card.Title>
								<Card.Description>
									{t(
										'Select the columns each privilege applies to (Ctrl/Cmd-click for several). A privilege already granted on the whole table makes its column list redundant.'
									)}
								</Card.Description>
							</Card.Header>
							<Card.Content class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
								{#each data.columnPrivilegeNames as priv (priv)}
									<div class="grid gap-1.5">
										<label for="col-{priv}" class="text-sm font-medium"
											><code class="font-mono text-[13px]">{priv}</code></label
										>
										<select
											id="col-{priv}"
											name="col_{priv}"
											multiple
											size={Math.min(8, Math.max(3, editing.columns.length))}
											disabled={!data.isGrantUser}
											class="w-full rounded-lg border border-input bg-background p-2 font-mono text-sm"
										>
											{#each editing.columns as c (c)}
												<option value={c} selected={editing.columnPrivileges[priv]?.includes(c)}
													>{c}</option
												>
											{/each}
										</select>
									</div>
								{/each}
							</Card.Content>
						</Card.Root>
					{/snippet}
				</ScopedEditor>
			{/key}
		{/if}
	{/if}
</AccountEditShell>
