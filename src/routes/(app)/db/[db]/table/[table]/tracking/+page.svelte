<script lang="ts">
	import { enhance } from '$app/forms';
	import Download from '@lucide/svelte/icons/download';
	import FileText from '@lucide/svelte/icons/file-text';
	import History from '@lucide/svelte/icons/history';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import VersionForm from '#lib/components/tracking/version-form.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	let { data, form }: PageProps = $props();

	const base = $derived(
		`/db/${encodeURIComponent(data.db)}/table/${encodeURIComponent(data.table)}/tracking`
	);
	const message = $derived(form && 'message' in form ? String(form.message) : '');
	const error = $derived(form && 'error' in form ? String(form.error) : '');

	const filterQuery = (extra: Record<string, string>) => {
		if (!data.available || data.version === null) return '';
		const p = new URLSearchParams({
			report: '1',
			version: String(data.version),
			logtype: data.filter.logtype,
			date_from: data.filter.from,
			date_to: data.filter.to,
			users: data.filter.users,
			...extra
		});
		return p.toString();
	};
</script>

<svelte:head><title>{t('Tracking')} - {data.table}</title></svelte:head>

<div class="flex flex-col gap-6" data-testid="table-tracking">
	<PageHeader
		icon={History}
		title={t('Tracking')}
		description={t('Versions of {name} and the statements recorded for them.', {
			name: `${data.db}.${data.table}`
		})}
	/>

	{#if message}
		<Alert.Root role="status" data-testid="tracking-message"
			><Alert.Title>{message}</Alert.Title></Alert.Root
		>
	{/if}
	{#if error}
		<Alert.Root variant="destructive" role="alert"><Alert.Title>{error}</Alert.Title></Alert.Root>
	{/if}

	{#if !data.available}
		<Alert.Root role="status" data-testid="tracking-disabled">
			<Alert.Title>{t('Tracking is not available')}</Alert.Title>
			<Alert.Description>
				{t('The tracking table of the configuration storage is not configured or not reachable.')}
			</Alert.Description>
		</Alert.Root>
	{:else}
		{#if data.view === 'report'}
			<Card.Root data-testid="tracking-report">
				<Card.Header>
					<Card.Title>{t('Tracking report, version {version}', { version: data.version ?? 0 })}</Card.Title>
					<Card.Description>{t('Tracking statements: {statements}', { statements: data.tracking })}</Card.Description>
					<Card.Action><Button variant="outline" href={base}>{t('Close')}</Button></Card.Action>
				</Card.Header>
				<Card.Content class="flex flex-col gap-5">
					<form method="GET" action={base} class="flex flex-wrap items-end gap-3">
						<input type="hidden" name="report" value="1" />
						<input type="hidden" name="version" value={data.version} />
						<div class="flex flex-col gap-1.5">
							<Label for="logtype">{t('Show')}</Label>
							<NativeSelect id="logtype" name="logtype" value={data.filter.logtype}>
								<NativeSelectOption value="schema">{t('Structure only')}</NativeSelectOption>
								<NativeSelectOption value="data">{t('Data only')}</NativeSelectOption>
								<NativeSelectOption value="schema_and_data">{t('Structure and data')}</NativeSelectOption>
							</NativeSelect>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="date_from">{t('From')}</Label>
							<Input
								id="date_from"
								name="date_from"
								value={data.filter.from}
								placeholder={data.dateFrom}
								class="w-48"
							/>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="date_to">{t('To')}</Label>
							<Input
								id="date_to"
								name="date_to"
								value={data.filter.to}
								placeholder={data.dateTo}
								class="w-48"
							/>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="users">{t('By user')}</Label>
							<Input id="users" name="users" value={data.filter.users} class="w-40" />
						</div>
						<Button type="submit">{t('Go')}</Button>
					</form>

					{#each [{ key: 'ddl', title: t('Data definition statements'), rows: data.ddl, show: data.filter.logtype !== 'data' }, { key: 'dml', title: t('Data manipulation statements'), rows: data.dml, show: data.filter.logtype !== 'schema' }] as log (log.key)}
						{#if log.show}
							<div class="flex flex-col gap-2" data-testid="log-{log.key}">
								<h3 class="text-sm font-semibold">{log.title}</h3>
								<Table.Root>
									<Table.Header>
										<Table.Row>
											<Table.Head class="w-10">#</Table.Head>
											<Table.Head>{t('Date')}</Table.Head>
											<Table.Head>{t('Username')}</Table.Head>
											<Table.Head>{t('Statement')}</Table.Head>
											<Table.Head class="w-12"></Table.Head>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{#each log.rows as e (e.id)}
											<Table.Row>
												<Table.Cell>{e.id + 1}</Table.Cell>
												<Table.Cell class="whitespace-nowrap">{e.date}</Table.Cell>
												<Table.Cell>{e.username}</Table.Cell>
												<Table.Cell>
													<pre
														class="font-mono text-xs break-all whitespace-pre-wrap">{e.statement}</pre>
												</Table.Cell>
												<Table.Cell>
													<form method="POST" action="?/deleteLog" use:enhance>
														<input type="hidden" name="version" value={data.version} />
														<input type="hidden" name="which" value={log.key} />
														<input type="hidden" name="id" value={e.id} />
														<Button
															type="submit"
															variant="ghost"
															size="icon-sm"
															aria-label={t('Delete tracking row {n}', { n: e.id + 1 })}
														>
															<Trash2 />
														</Button>
													</form>
												</Table.Cell>
											</Table.Row>
										{:else}
											<Table.Row>
												<Table.Cell colspan={5} class="text-center text-muted-foreground">
													{t('No data')}
												</Table.Cell>
											</Table.Row>
										{/each}
									</Table.Body>
								</Table.Root>
							</div>
						{/if}
					{/each}

					<div class="flex flex-wrap items-center gap-2 border-t pt-4" data-testid="report-export">
						<span class="text-sm text-muted-foreground">{t('Export as')}</span>
						<Button variant="outline" size="sm" href="{base}?{filterQuery({ export: 'sqldump' })}">
							<FileText /> {t('SQL dump')}
						</Button>
						<Button
							variant="outline"
							size="sm"
							href="{base}/download?{filterQuery({})}"
							data-sveltekit-reload
						>
							<Download /> {t('SQL dump (file download)')}
						</Button>
						<form method="POST" action="?/execute" use:enhance class="contents">
							<input type="hidden" name="version" value={data.version} />
							<input type="hidden" name="logtype" value={data.filter.logtype} />
							<input type="hidden" name="date_from" value={data.filter.from} />
							<input type="hidden" name="date_to" value={data.filter.to} />
							<input type="hidden" name="users" value={data.filter.users} />
							<Button type="submit" variant="outline" size="sm" data-testid="report-execute">
								{t('SQL execution')}
							</Button>
						</form>
						<span class="text-xs text-muted-foreground">
							{t('Executing replaces your table and contained data.')}
						</span>
					</div>
					{#if data.dump !== null}
						<Textarea
							readonly
							rows={10}
							value={data.dump}
							aria-label={t('SQL dump')}
							class="font-mono text-xs"
							data-testid="report-dump"
						/>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		{#if data.view === 'snapshot' && data.snapshot}
			<Card.Root data-testid="tracking-snapshot">
				<Card.Header>
					<Card.Title>{t('Structure snapshot, version {version}', { version: data.version ?? 0 })}</Card.Title>
					<Card.Action><Button variant="outline" href={base}>{t('Close')}</Button></Card.Action>
				</Card.Header>
				<Card.Content class="flex flex-col gap-4">
					<pre
						class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{data.createStatement}</pre>
					<Table.Root>
						<Table.Header>
							<Table.Row>
								{#each ['Field', 'Type', 'Collation', 'Null', 'Key', 'Default', 'Extra', 'Comment'] as h (h)}
									<Table.Head>{h}</Table.Head>
								{/each}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.snapshot.COLUMNS as c, i (i)}
								<Table.Row>
									{#each ['Field', 'Type', 'Collation', 'Null', 'Key', 'Default', 'Extra', 'Comment'] as k (k)}
										<Table.Cell class="font-mono text-xs">{c[k] ?? ''}</Table.Cell>
									{/each}
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
					{#if data.snapshot.INDEXES.length > 0}
						<Table.Root>
							<Table.Header>
								<Table.Row>
									{#each ['Key_name', 'Non_unique', 'Seq_in_index', 'Column_name', 'Collation', 'Cardinality', 'Index_type'] as h (h)}
										<Table.Head>{h}</Table.Head>
									{/each}
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each data.snapshot.INDEXES as c, i (i)}
									<Table.Row>
										{#each ['Key_name', 'Non_unique', 'Seq_in_index', 'Column_name', 'Collation', 'Cardinality', 'Index_type'] as k (k)}
											<Table.Cell class="font-mono text-xs">{c[k] ?? ''}</Table.Cell>
										{/each}
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		{#if data.versions.length > 0}
			<Card.Root>
				<Card.Header><Card.Title>{t('Versions')}</Card.Title></Card.Header>
				<Card.Content>
					<Table.Root data-testid="versions">
						<Table.Header>
							<Table.Row>
								<Table.Head>{t('Version')}</Table.Head>
								<Table.Head>{t('Created')}</Table.Head>
								<Table.Head>{t('Updated')}</Table.Head>
								<Table.Head>{t('Status')}</Table.Head>
								<Table.Head>{t('Tracking statements')}</Table.Head>
								<Table.Head>{t('Actions')}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.versions as v (v.version)}
								<Table.Row data-testid="version-{v.version}">
									<Table.Cell>{v.version}</Table.Cell>
									<Table.Cell class="whitespace-nowrap">{v.created}</Table.Cell>
									<Table.Cell class="whitespace-nowrap">{v.updated}</Table.Cell>
									<Table.Cell>
										<Badge variant={v.active ? 'default' : 'secondary'}>
											{v.active ? t('active') : t('not active')}
										</Badge>
									</Table.Cell>
									<Table.Cell class="max-w-sm text-xs break-words">{v.tracking}</Table.Cell>
									<Table.Cell>
										<div class="flex flex-wrap gap-1">
											<Button
												variant="outline"
												size="sm"
												href="{base}?report=1&version={v.version}"
											>
												{t('Tracking report')}
											</Button>
											<Button
												variant="outline"
												size="sm"
												href="{base}?snapshot=1&version={v.version}"
											>
												{t('Structure snapshot')}
											</Button>
											<form
												method="POST"
												action={v.active ? '?/deactivate' : '?/activate'}
												use:enhance
												class="contents"
											>
												<input type="hidden" name="version" value={v.version} />
												<Button type="submit" variant="outline" size="sm">
													{v.active ? t('Deactivate') : t('Activate')}
												</Button>
											</form>
											<form method="POST" action="?/deleteVersion" use:enhance class="contents">
												<input type="hidden" name="version" value={v.version} />
												<Button
													type="submit"
													variant="outline"
													size="sm"
													aria-label={t('Delete version {version}', { version: v.version })}
												>
													<Trash2 /> {t('Delete version')}
												</Button>
											</form>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title>
					{data.versions.length === 0
						? t('Track this table')
						: t('Create version {version}', { version: data.nextVersion })}
				</Card.Title>
				<Card.Description>
					{t('Creates a snapshot of the structure of {table} and starts recording the chosen statements.', { table: data.table })}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#key data.nextVersion}
					<VersionForm action="?/create" defaults={data.defaults} version={data.nextVersion} />
				{/key}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
