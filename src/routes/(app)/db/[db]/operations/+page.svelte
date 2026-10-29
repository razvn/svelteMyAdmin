<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { getNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Collapsible from '#lib/components/ui/collapsible/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { N_, useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	const { t } = useI18n();

	let { data }: PageProps = $props();
	const navState = getNavState();
	const dbName = $derived(page.params.db ?? '');

	interface Outcome {
		ok: boolean;
		message: string;
		sql: string[];
	}

	// Kept across the navigation to a renamed/copied database (the component instance is reused).
	let results = $state<Record<string, Outcome>>({});
	let busy = $state<string | null>(null);
	let dropOpen = $state(false);
	let dropForm = $state<HTMLFormElement>();
	let collation = $derived(data.collation);

	const dbHref = (name: string) => `/db/${encodeURIComponent(name)}`;
	const byCharset = $derived(
		Object.entries(Object.groupBy(data.collations, (c) => c.charset)).map(([charset, list]) => ({
			charset,
			list: list ?? []
		}))
	);

	/** Shared `use:enhance` callback: records the outcome, then reloads or navigates. */
	function submit(action: string) {
		return () => {
			busy = action;
			return async ({
				result,
				update
			}: {
				result: {
					type: string;
					data?: Record<string, unknown>;
					location?: string;
				};
				update: (o?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void>;
			}) => {
				const d = result.data as (Outcome & { goto?: string }) | undefined;
				if (d && 'ok' in d) {
					results[action] = { ok: d.ok, message: d.message, sql: d.sql ?? [] };
					if (d.ok) toast.success(d.message);
				}
				if (result.type === 'success' && d) {
					if (d.goto) {
						// eslint-disable-next-line svelte/no-navigation-without-resolve -- in-app path built by the server
						await goto(d.goto.startsWith('/') ? d.goto : `${dbHref(d.goto)}/operations`, {
							refreshAll: true
						});
						await navState.reload();
					} else {
						await update({ reset: false });
						await navState.reload();
					}
				} else {
					await update({ reset: false });
				}
				busy = null;
			};
		};
	}
</script>

{#snippet outcome(action: string)}
	{@const r = results[action]}
	{#if r}
		<Alert
			variant={r.ok ? 'success' : 'destructive'}
			class="mt-4"
			data-testid="result-{action}"
			role={r.ok ? 'status' : 'alert'}
		>
			<AlertDescription>
				{r.message}
			</AlertDescription>
			{#if r.sql.length > 0}
				<Collapsible.Root class="mt-2">
					<Collapsible.Trigger
						class="inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
					>
						<ChevronDown class="size-4" /> SQL ({r.sql.length})
					</Collapsible.Trigger>
					<Collapsible.Content>
						<pre
							class="mt-2 max-h-72 overflow-auto rounded-lg border bg-card p-3 font-mono text-xs whitespace-pre-wrap text-foreground"
							data-testid="sql-{action}">{r.sql.join(';\n') + ';'}</pre>
					</Collapsible.Content>
				</Collapsible.Root>
			{/if}
		</Alert>
	{/if}
{/snippet}

{#snippet option(id: string, name: string, label: string, checked: boolean, disabled = false)}
	<div class="flex items-center gap-2">
		<Checkbox {id} {name} value="1" {checked} {disabled} />
		<Label for={id} class="font-normal">{label}</Label>
	</div>
{/snippet}

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Settings2}
		title={t('Operations')}
		description={t('Rename, copy, change the collation of or remove {name}.', { name: dbName })}
	>
		{#snippet actions()}
			<Button variant="outline" href="{dbHref(dbName)}/data-dictionary">
				<BookOpen class="size-4" />
				{t('Data dictionary')}
			</Button>
		{/snippet}
	</PageHeader>

	{#if data.isSystemSchema}
		<Alert variant="warning">
			<AlertDescription>
				{t('Operations are not available for the system schema "{name}".', { name: dbName })}
			</AlertDescription>
		</Alert>
	{:else}
		{#if data.hasComment}
			<Card.Root>
				<Card.Header><Card.Title>{t('Database comment')}</Card.Title></Card.Header>
				<Card.Content>
					<form method="POST" action="?/comment" use:enhance={submit('comment')} class="flex gap-2">
						<Input
							name="comment"
							value={data.comment}
							maxlength={255}
							aria-label={t('Database comment')}
							class="max-w-md"
						/>
						<Button type="submit" disabled={busy === 'comment'}>{t('Go')}</Button>
					</form>
					{@render outcome('comment')}
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header><Card.Title>{t('Create new table')}</Card.Title></Card.Header>
			<Card.Content>
				<form
					method="GET"
					action="{dbHref(dbName)}/create-table"
					class="flex flex-wrap items-end gap-3"
				>
					<div class="flex flex-col gap-1.5">
						<Label for="create-table-name">{t('Table name')}</Label>
						<Input id="create-table-name" name="name" maxlength={64} required class="w-64" />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="create-table-num">{t('Number of columns')}</Label>
						<Input
							id="create-table-num"
							name="num_fields"
							type="number"
							min="1"
							value="4"
							required
							class="w-36"
						/>
					</div>
					<Button type="submit">{t('Create')}</Button>
				</form>
			</Card.Content>
		</Card.Root>

		{#if dbName !== 'mysql'}
			<Card.Root>
				<Card.Header><Card.Title>{t('Rename database to')}</Card.Title></Card.Header>
				<Card.Content>
					<form
						method="POST"
						action="?/rename"
						use:enhance={submit('rename')}
						class="flex flex-col gap-4"
						data-testid="rename-form"
					>
						<Input
							name="newname"
							placeholder={dbName}
							maxlength={64}
							required
							aria-label={t('New database name')}
							class="max-w-md"
						/>
						{@render option(
							'rename-priv',
							'adjust_privileges',
							t('Adjust privileges'),
							data.canAdjustPrivileges,
							!data.canAdjustPrivileges
						)}
						<div><Button type="submit" disabled={busy === 'rename'}>{t('Go')}</Button></div>
					</form>
					{@render outcome('rename')}
				</Card.Content>
			</Card.Root>
		{/if}

		{#if data.dropAllowed}
			<Card.Root>
				<Card.Header><Card.Title>{t('Remove database')}</Card.Title></Card.Header>
				<Card.Content>
					<Button
						variant="destructive"
						onclick={() => (dropOpen = true)}
						data-testid="drop-db"
						disabled={busy === 'drop'}
					>
						{t('Drop the database (DROP)')}
					</Button>
					<form
						bind:this={dropForm}
						method="POST"
						action="?/drop"
						use:enhance={submit('drop')}
						class="hidden"
					></form>
					{@render outcome('drop')}
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header><Card.Title>{t('Copy database to')}</Card.Title></Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/copy"
					use:enhance={submit('copy')}
					class="flex flex-col gap-4"
					data-testid="copy-form"
				>
					<Input
						name="newname"
						placeholder={dbName}
						maxlength={64}
						required
						aria-label={t('Copy to database name')}
						class="max-w-md"
					/>
					<div class="flex flex-col gap-2" role="radiogroup" aria-label={t('What to copy')}>
						{#each [{ v: 'structure', label: N_('Structure only') }, { v: 'data', label: N_('Structure and data') }, { v: 'dataonly', label: N_('Data only') }] as o (o.v)}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="radio"
									name="what"
									value={o.v}
									checked={o.v === 'data'}
									class="size-4 accent-primary"
								/>
								{t(o.label)}
							</label>
						{/each}
					</div>
					<div class="flex flex-col gap-2">
						{@render option(
							'cp-create',
							'create_database_before_copying',
							t('CREATE DATABASE before copying'),
							true
						)}
						{@render option('cp-drop', 'drop_if_exists', t('Add DROP TABLE / DROP VIEW'), false)}
						{@render option('cp-ai', 'sql_auto_increment', t('Add AUTO_INCREMENT value'), true)}
						{@render option('cp-fk', 'add_constraints', t('Add constraints'), true)}
						{@render option(
							'cp-priv',
							'adjust_privileges',
							t('Adjust privileges'),
							data.canAdjustPrivileges,
							!data.canAdjustPrivileges
						)}
						{@render option('cp-switch', 'switch_to_new', t('Switch to copied database'), false)}
					</div>
					<div><Button type="submit" disabled={busy === 'copy'}>{t('Go')}</Button></div>
				</form>
				{@render outcome('copy')}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title>{t('Collation')}</Card.Title></Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/collation"
					use:enhance={submit('collation')}
					class="flex flex-col gap-4"
					data-testid="collation-form"
				>
					<Select.Root type="single" name="db_collation" bind:value={collation}>
						<Select.Trigger class="w-72" aria-label={t('Collation')}>
							{collation || t('Collation')}
						</Select.Trigger>
						<Select.Content class="max-h-72">
							{#each byCharset as group (group.charset)}
								<Select.Group>
									<Select.GroupHeading>{group.charset}</Select.GroupHeading>
									{#each group.list as c (c.name)}
										<Select.Item value={c.name} label={c.name}>{c.name}</Select.Item>
									{/each}
								</Select.Group>
							{/each}
						</Select.Content>
					</Select.Root>
					<div class="flex flex-col gap-2">
						{@render option(
							'co-tables',
							'change_all_tables_collations',
							t('Change all tables collations'),
							false
						)}
						{@render option(
							'co-cols',
							'change_all_tables_columns_collations',
							t('Change all tables columns collations'),
							false
						)}
					</div>
					<div><Button type="submit" disabled={busy === 'collation'}>{t('Go')}</Button></div>
				</form>
				{@render outcome('collation')}
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<AlertDialog.Root bind:open={dropOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{t('Confirm')}</AlertDialog.Title>
			<AlertDialog.Description>
				{t('You are about to DESTROY a complete database! This cannot be undone. Drop {name}?', {
					name: dbName
				})}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{t('Cancel')}</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				onclick={(e: MouseEvent) => {
					e.preventDefault();
					dropOpen = false;
					dropForm?.requestSubmit();
				}}
			>
				{t('Drop')}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
