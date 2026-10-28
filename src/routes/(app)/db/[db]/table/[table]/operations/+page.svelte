<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- in-app paths built by the server action */
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import MaintenanceResults from '#lib/components/database/maintenance-results.svelte';
	import { getNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Collapsible from '#lib/components/ui/collapsible/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import {
		MAINTENANCE_LABELS,
		buildDropSql,
		buildOptionStatements,
		buildRenameSql,
		buildReorderSql,
		buildTruncateSql,
		maintenanceActionsFor,
		optionSupport,
		partitionOperationsFor,
		rowFormatsFor
	} from '#lib/sql/table-operations.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const navState = getNavState();
	const db = $derived(page.params.db ?? '');
	const table = $derived(page.params.table ?? '');

	interface Outcome {
		action: string;
		ok: boolean;
		message: string;
		sql: string[];
	}

	let last = $state<Outcome | null>(null);
	let busy = $state<string | null>(null);
	let results = $state.raw<{ statement: string; rows: Record<string, string>[] }[]>([]);
	let resultsOpen = $state(false);
	let resultsTitle = $state('');

	/* ---- form state (re-synced whenever the server data changes) ---- */
	let orderField = $state('');
	let orderDesc = $state(false);
	let moveDb = $state('');
	let copyDb = $state('');
	let renameTo = $state('');
	let comment = $state('');
	let engine = $state('');
	let collation = $state('');
	let changeAll = $state(false);
	let packKeys = $state('DEFAULT');
	let checksum = $state(false);
	let delayKeyWrite = $state(false);
	let transactional = $state(true);
	let pageChecksum = $state(true);
	let autoIncrement = $state('');
	let rowFormat = $state('');
	let copyWhat = $state('data');
	let partitionOp = $state('ANALYZE');
	let selectedPartitions = $state<string[]>([]);

	$effect(() => {
		const o = data.options;
		comment = o.comment;
		engine = o.engine;
		collation = o.collation;
		packKeys = o.packKeys;
		checksum = o.checksum;
		delayKeyWrite = o.delayKeyWrite;
		transactional = o.transactional;
		pageChecksum = o.pageChecksum;
		autoIncrement = o.autoIncrement;
		rowFormat =
			rowFormatsFor(o.engine).find((f) => f.toLowerCase() === o.rowFormat.toLowerCase()) ?? '';
		changeAll = false;
		renameTo = '';
		orderField = data.columns[0] ?? '';
		moveDb = db;
		copyDb = db;
		partitionOp = 'ANALYZE';
		selectedPartitions = data.partitions ? [data.partitions.names[0]] : [];
	});

	const support = $derived(optionSupport(data.options.engine));
	const rowFormats = $derived(rowFormatsFor(data.options.engine));
	const maintenance = $derived(maintenanceActionsFor(data.options.engine, data.isView));
	const partitionOps = $derived(
		data.partitions ? partitionOperationsFor(data.partitions.method) : []
	);
	const byCharset = $derived(
		Object.entries(Object.groupBy(data.collations, (c) => c.charset)).map(([charset, list]) => ({
			charset,
			list: list ?? []
		}))
	);

	/** Live preview of what the options form will run. */
	const optionsPreview = $derived.by(() => {
		const out: string[] = [];
		let name = table;
		if (renameTo.trim() !== '' && renameTo !== table) {
			out.push(buildRenameSql(db, table, db, renameTo));
			name = renameTo;
		}
		out.push(
			...buildOptionStatements(
				name,
				data.options,
				{
					comment,
					engine,
					collation,
					charset: data.collations.find((c) => c.name === collation)?.charset,
					packKeys: support.packKeys ? packKeys : undefined,
					checksum: support.checksumAndDelayKeyWrite ? checksum : undefined,
					delayKeyWrite: support.checksumAndDelayKeyWrite ? delayKeyWrite : undefined,
					transactional: support.transactionalAndPageChecksum ? transactional : undefined,
					pageChecksum: support.transactionalAndPageChecksum ? pageChecksum : undefined,
					autoIncrement,
					rowFormat
				},
				changeAll
			)
		);
		return out;
	});
	const reorderPreview = $derived(
		orderField ? buildReorderSql(table, orderField, orderDesc ? 'desc' : 'asc') : ''
	);

	/* ---- delete data / table (confirmation with the SQL) ---- */
	let dangerOpen = $state(false);
	let dangerKind = $state<'empty' | 'drop'>('empty');
	let fkChecks = $state(true);
	let emptyForm = $state<HTMLFormElement>();
	let dropForm = $state<HTMLFormElement>();
	const dangerSql = $derived(
		dangerKind === 'empty' ? buildTruncateSql(db, table) : buildDropSql(db, table, data.isView)
	);

	function ask(kind: 'empty' | 'drop') {
		dangerKind = kind;
		fkChecks = true;
		dangerOpen = true;
	}

	/** Shared `use:enhance` callback: records the outcome, then reloads or navigates. */
	function submit(action: string) {
		return () => {
			busy = action;
			return async ({
				result,
				update
			}: {
				result: { type: string; data?: Record<string, unknown> };
				update: (o?: { reset?: boolean }) => Promise<void>;
			}) => {
				const d = result.data as
					| (Outcome & {
							goto?: string;
							reload?: boolean;
							results?: { statement: string; rows: Record<string, string>[] }[];
					  })
					| undefined;
				if (d && 'ok' in d) {
					last = { action, ok: d.ok, message: d.message, sql: d.sql ?? [] };
					if (d.ok) toast.success(d.message);
					else toast.error(d.message);
					if (d.results && d.results.length > 0) {
						results = d.results;
						resultsTitle = d.message;
						resultsOpen = true;
					}
				}
				if (result.type === 'success' && d?.goto) {
					await goto(d.goto, { refreshAll: true });
				} else {
					await update({ reset: false });
				}
				if (d?.reload) await navState.reload();
				dangerOpen = false;
				busy = null;
			};
		};
	}

	const dbHref = (name: string) => `/db/${encodeURIComponent(name)}`;
</script>

{#snippet option(id: string, name: string, label: string, checked: boolean, disabled = false)}
	<div class="flex items-center gap-2">
		<Checkbox {id} {name} value="1" {checked} {disabled} />
		<Label for={id} class="font-normal">{label}</Label>
	</div>
{/snippet}

{#snippet sqlBlock(sql: string[], testid: string)}
	<pre
		class="max-h-60 overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
		data-testid={testid}>{sql.join(';\n') + ';'}</pre>
{/snippet}

{#snippet dbSelect(name: string, value: string, onchange: (v: string) => void)}
	<Select.Root type="single" {name} {value} onValueChange={onchange}>
		<Select.Trigger class="w-56" aria-label="Database">{value}</Select.Trigger>
		<Select.Content class="max-h-72">
			{#each data.databases as d (d)}
				<Select.Item value={d} label={d}>{d}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/snippet}

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Settings2}
		title="Operations"
		description="{data.isView ? 'View' : 'Table'} {table} · {data.options.engine || 'view'}"
	/>

	{#if last}
		<Alert
			variant={last.ok ? 'success' : 'destructive'}
			data-testid="outcome"
			role={last.ok ? 'status' : 'alert'}
		>
			<AlertDescription>{last.message}</AlertDescription>
			{#if last.sql.length > 0}
				<Collapsible.Root class="mt-2">
					<Collapsible.Trigger
						class="inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
					>
						<ChevronDown class="size-4" /> SQL ({last.sql.length})
					</Collapsible.Trigger>
					<Collapsible.Content>
						<div class="mt-2">{@render sqlBlock(last.sql, 'outcome-sql')}</div>
					</Collapsible.Content>
				</Collapsible.Root>
			{/if}
		</Alert>
	{/if}

	{#if data.isSystemSchema}
		<Alert variant="warning">
			<AlertDescription>
				Operations that change data are not available in the system schema "{db}".
			</AlertDescription>
		</Alert>
	{/if}

	{#if data.isView}
		<Card.Root>
			<Card.Header><Card.Title>View</Card.Title></Card.Header>
			<Card.Content>
				<Button variant="outline" disabled title="Editing views is not available yet">
					Edit view
				</Button>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if !data.isView && !data.isSystemSchema}
		<Card.Root>
			<Card.Header><Card.Title>Alter table order by</Card.Title></Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/reorder"
					use:enhance={submit('reorder')}
					class="flex flex-col gap-4"
					data-testid="reorder-form"
				>
					<div class="flex flex-wrap items-center gap-4">
						<Select.Root type="single" name="order_field" bind:value={orderField}>
							<Select.Trigger class="w-56" aria-label="Column">{orderField}</Select.Trigger>
							<Select.Content class="max-h-72">
								{#each data.columns as c (c)}
									<Select.Item value={c} label={c}>{c}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<label class="flex items-center gap-2 text-sm">
							<input
								type="radio"
								name="order_order"
								value="asc"
								checked={!orderDesc}
								onchange={() => (orderDesc = false)}
								class="size-4 accent-primary"
							/>
							Ascending
						</label>
						<label class="flex items-center gap-2 text-sm">
							<input
								type="radio"
								name="order_order"
								value="desc"
								checked={orderDesc}
								onchange={() => (orderDesc = true)}
								class="size-4 accent-primary"
							/>
							Descending
						</label>
					</div>
					<p class="text-sm text-muted-foreground" data-testid="reorder-hint">
						{#if data.innodbClustered}
							InnoDB always keeps rows ordered by its PRIMARY KEY (or first NOT NULL UNIQUE index),
							so this has no lasting effect on this table.
						{:else}
							Reorders the rows once; rows inserted later are not kept in this order. Most useful
							for MyISAM tables.
						{/if}
					</p>
					{#if reorderPreview}
						<code class="font-mono text-xs text-muted-foreground">{reorderPreview}</code>
					{/if}
					<div><Button type="submit" disabled={busy === 'reorder'}>Go</Button></div>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if !data.isSystemSchema}
		<Card.Root>
			<Card.Header>
				<Card.Title>Move {data.isView ? 'view' : 'table'} to (database.table)</Card.Title>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/move"
					use:enhance={submit('move')}
					class="flex flex-col gap-4"
					data-testid="move-form"
				>
					<div class="flex flex-wrap items-center gap-2">
						{@render dbSelect('target_db', moveDb, (v) => (moveDb = v))}
						<span class="text-muted-foreground">.</span>
						<Input
							name="new_name"
							placeholder={table}
							maxlength={64}
							required
							aria-label="New table name"
							class="w-64"
						/>
					</div>
					{@render option(
						'mv-priv',
						'adjust_privileges',
						'Adjust privileges',
						data.canAdjustPrivileges,
						!data.canAdjustPrivileges
					)}
					<div><Button type="submit" disabled={busy === 'move'}>Go</Button></div>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if !data.isView && !data.isSystemSchema}
		<Card.Root>
			<Card.Header><Card.Title>Table options</Card.Title></Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/options"
					use:enhance={submit('options')}
					class="flex flex-col gap-4"
					data-testid="options-form"
				>
					<div class="flex flex-wrap items-center gap-3">
						<Label for="opt-rename" class="w-40">Rename table to</Label>
						<Input
							id="opt-rename"
							name="new_name"
							bind:value={renameTo}
							placeholder={table}
							maxlength={64}
							class="w-64"
						/>
					</div>
					{@render option(
						'opt-priv',
						'adjust_privileges',
						'Adjust privileges',
						data.canAdjustPrivileges,
						!data.canAdjustPrivileges
					)}
					<div class="flex flex-wrap items-center gap-3">
						<Label for="opt-comment" class="w-40">Table comments</Label>
						<Input
							id="opt-comment"
							name="comment"
							bind:value={comment}
							maxlength={2048}
							class="w-96 max-w-full"
						/>
					</div>
					<div class="flex flex-wrap items-center gap-3">
						<span class="w-40 text-sm font-medium">Storage engine</span>
						<Select.Root type="single" name="new_tbl_storage_engine" bind:value={engine}>
							<Select.Trigger class="w-56" aria-label="Storage engine">{engine}</Select.Trigger>
							<Select.Content class="max-h-72">
								{#each data.engines as e (e)}
									<Select.Item value={e} label={e}>{e}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="flex flex-wrap items-center gap-3">
						<span class="w-40 text-sm font-medium">Collation</span>
						<Select.Root type="single" name="tbl_collation" bind:value={collation}>
							<Select.Trigger class="w-72" aria-label="Collation">{collation}</Select.Trigger>
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
						<div class="flex items-center gap-2">
							<Checkbox
								id="opt-change-all"
								name="change_all_collations"
								value="1"
								bind:checked={changeAll}
							/>
							<Label for="opt-change-all" class="font-normal">Change all column collations</Label>
						</div>
					</div>

					{#if support.packKeys}
						<div class="flex flex-wrap items-center gap-3">
							<span class="w-40 text-sm font-medium">PACK_KEYS</span>
							<Select.Root type="single" name="new_pack_keys" bind:value={packKeys}>
								<Select.Trigger class="w-40" aria-label="PACK_KEYS">{packKeys}</Select.Trigger>
								<Select.Content>
									{#each ['DEFAULT', '0', '1'] as v (v)}
										<Select.Item value={v} label={v}>{v}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/if}
					{#if support.checksumAndDelayKeyWrite}
						<input type="hidden" name="has_checksum_group" value="1" />
						<div class="flex items-center gap-2">
							<Checkbox id="opt-checksum" name="new_checksum" value="1" bind:checked={checksum} />
							<Label for="opt-checksum" class="font-normal">CHECKSUM</Label>
						</div>
						<div class="flex items-center gap-2">
							<Checkbox
								id="opt-delay"
								name="new_delay_key_write"
								value="1"
								bind:checked={delayKeyWrite}
							/>
							<Label for="opt-delay" class="font-normal">DELAY_KEY_WRITE</Label>
						</div>
					{/if}
					{#if support.transactionalAndPageChecksum}
						<input type="hidden" name="has_aria_group" value="1" />
						<div class="flex items-center gap-2">
							<Checkbox
								id="opt-trans"
								name="new_transactional"
								value="1"
								bind:checked={transactional}
							/>
							<Label for="opt-trans" class="font-normal">TRANSACTIONAL</Label>
						</div>
						<div class="flex items-center gap-2">
							<Checkbox
								id="opt-page"
								name="new_page_checksum"
								value="1"
								bind:checked={pageChecksum}
							/>
							<Label for="opt-page" class="font-normal">PAGE_CHECKSUM</Label>
						</div>
					{/if}
					{#if support.autoIncrement && data.options.autoIncrement !== ''}
						<div class="flex flex-wrap items-center gap-3">
							<Label for="opt-ai" class="w-40">AUTO_INCREMENT</Label>
							<Input
								id="opt-ai"
								name="new_auto_increment"
								type="number"
								min="0"
								bind:value={autoIncrement}
								class="w-56"
							/>
						</div>
					{/if}
					{#if support.rowFormat && rowFormats.length > 0}
						<div class="flex flex-wrap items-center gap-3">
							<span class="w-40 text-sm font-medium">ROW_FORMAT</span>
							<Select.Root type="single" name="new_row_format" bind:value={rowFormat}>
								<Select.Trigger class="w-56" aria-label="ROW_FORMAT">{rowFormat}</Select.Trigger>
								<Select.Content>
									{#each rowFormats as f (f)}
										<Select.Item value={f} label={f}>{f}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/if}

					<div class="flex flex-col gap-1.5">
						<span class="text-sm font-medium">SQL preview</span>
						{#if optionsPreview.length > 0}
							{@render sqlBlock(optionsPreview, 'options-preview')}
						{:else}
							<p class="text-sm text-muted-foreground" data-testid="options-preview">No change.</p>
						{/if}
					</div>
					<div><Button type="submit" disabled={busy === 'options'}>Go</Button></div>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title>Copy table to (database.table)</Card.Title></Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/copy"
					use:enhance={submit('copy')}
					class="flex flex-col gap-4"
					data-testid="copy-form"
				>
					<div class="flex flex-wrap items-center gap-2">
						{@render dbSelect('target_db', copyDb, (v) => (copyDb = v))}
						<span class="text-muted-foreground">.</span>
						<Input
							name="new_name"
							placeholder={table}
							maxlength={64}
							required
							aria-label="Copy to table name"
							class="w-64"
						/>
					</div>
					<div class="flex flex-col gap-2" role="radiogroup" aria-label="What to copy">
						{#each [{ v: 'structure', t: 'Structure only' }, { v: 'data', t: 'Structure and data' }, { v: 'dataonly', t: 'Data only' }] as o (o.v)}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="radio"
									name="what"
									value={o.v}
									checked={copyWhat === o.v}
									onchange={() => (copyWhat = o.v)}
									class="size-4 accent-primary"
								/>
								{o.t}
							</label>
						{/each}
					</div>
					<div class="flex flex-col gap-2">
						{@render option('cp-drop', 'drop_if_exists', 'Add DROP TABLE', false)}
						{@render option('cp-ai', 'sql_auto_increment', 'Add AUTO_INCREMENT value', false)}
						{#if data.hasForeignKeys}
							{@render option('cp-fk', 'add_constraints', 'Add constraints', true)}
						{/if}
						{@render option(
							'cp-priv',
							'adjust_privileges',
							'Adjust privileges',
							data.canAdjustPrivileges,
							!data.canAdjustPrivileges
						)}
						{@render option('cp-switch', 'switch_to_new', 'Switch to copied table', false)}
					</div>
					<div><Button type="submit" disabled={busy === 'copy'}>Go</Button></div>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header><Card.Title>Table maintenance</Card.Title></Card.Header>
		<Card.Content>
			<ul class="flex flex-col gap-1" data-testid="maintenance">
				{#each maintenance as a (a)}
					<li>
						<form method="POST" action="?/maintenance" use:enhance={submit('maintenance')}>
							<input type="hidden" name="action" value={a} />
							<Button
								type="submit"
								variant="link"
								class="h-auto p-0"
								disabled={busy === 'maintenance' ||
									(data.isSystemSchema && a !== 'check' && a !== 'checksum')}
							>
								{MAINTENANCE_LABELS[a]}
							</Button>
						</form>
					</li>
				{/each}
			</ul>
		</Card.Content>
	</Card.Root>

	{#if !data.isSystemSchema}
		<Card.Root>
			<Card.Header><Card.Title>Delete data or table</Card.Title></Card.Header>
			<Card.Content class="flex flex-col items-start gap-2">
				{#if !data.isView}
					<Button
						variant="destructive"
						onclick={() => ask('empty')}
						data-testid="empty-table"
						disabled={busy === 'empty'}
					>
						Empty the table (TRUNCATE)
					</Button>
				{/if}
				<Button
					variant="destructive"
					onclick={() => ask('drop')}
					data-testid="drop-table"
					disabled={busy === 'drop'}
				>
					Delete the {data.isView ? 'view' : 'table'} (DROP)
				</Button>
				<form
					bind:this={emptyForm}
					method="POST"
					action="?/empty"
					use:enhance={submit('empty')}
					class="hidden"
				>
					<input type="hidden" name="fk_checks" value={fkChecks ? '1' : '0'} />
				</form>
				<form
					bind:this={dropForm}
					method="POST"
					action="?/drop"
					use:enhance={submit('drop')}
					class="hidden"
				>
					<input type="hidden" name="fk_checks" value={fkChecks ? '1' : '0'} />
				</form>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if data.partitions && !data.isSystemSchema}
		<Card.Root>
			<Card.Header><Card.Title>Partition maintenance</Card.Title></Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/partition"
					use:enhance={submit('partition')}
					class="flex flex-col gap-4"
					data-testid="partition-form"
				>
					<fieldset class="flex flex-col gap-2">
						<legend class="mb-1 text-sm font-medium">Partition</legend>
						{#each data.partitions.names as p (p)}
							<div class="flex items-center gap-2">
								<Checkbox
									id="part-{p}"
									name="partitions"
									value={p}
									checked={selectedPartitions.includes(p)}
									onCheckedChange={(v) =>
										(selectedPartitions = v
											? [...selectedPartitions, p]
											: selectedPartitions.filter((x) => x !== p))}
								/>
								<Label for="part-{p}" class="font-mono font-normal">{p}</Label>
							</div>
						{/each}
					</fieldset>
					<div class="flex flex-wrap gap-4" role="radiogroup" aria-label="Partition operation">
						{#each partitionOps as op (op)}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="radio"
									name="operation"
									value={op}
									checked={partitionOp === op}
									onchange={() => (partitionOp = op)}
									class="size-4 accent-primary"
								/>
								{op[0] + op.slice(1).toLowerCase()}
							</label>
						{/each}
					</div>
					<div class="flex flex-wrap items-center gap-3">
						<Button type="submit" disabled={busy === 'partition'}>Go</Button>
					</div>
				</form>
				<form method="POST" action="?/unpartition" use:enhance={submit('unpartition')} class="mt-3">
					<Button
						type="submit"
						variant="link"
						class="h-auto p-0 text-destructive"
						disabled={busy === 'unpartition'}
					>
						Remove partitioning
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}

	<p class="text-sm text-muted-foreground">
		<a class="underline underline-offset-2" href="{dbHref(db)}/structure">Back to {db}</a>
	</p>
</div>

<!-- confirmation showing the SQL -->
<AlertDialog.Root bind:open={dangerOpen}>
	<AlertDialog.Content class="sm:max-w-xl" data-testid="confirm-dialog">
		<AlertDialog.Header>
			<AlertDialog.Title>Do you really want to execute the following query?</AlertDialog.Title>
			<AlertDialog.Description>This cannot be undone.</AlertDialog.Description>
		</AlertDialog.Header>
		<pre
			class="max-h-60 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
			data-testid="confirm-sql">{dangerSql};</pre>
		<div class="flex items-center gap-2">
			<Checkbox
				id="fk-checks"
				checked={fkChecks}
				onCheckedChange={(v) => (fkChecks = v === true)}
			/>
			<Label for="fk-checks" class="font-normal">Enable foreign key checks</Label>
		</div>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				disabled={busy === 'empty' || busy === 'drop'}
				onclick={(e: MouseEvent) => {
					e.preventDefault();
					(dangerKind === 'empty' ? emptyForm : dropForm)?.requestSubmit();
				}}
			>
				Yes
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- result of maintenance / partition operations -->
<Dialog.Root bind:open={resultsOpen}>
	<Dialog.Content class="max-h-[85vh] overflow-auto sm:max-w-3xl" data-testid="results-dialog">
		<Dialog.Header>
			<Dialog.Title>{resultsTitle}</Dialog.Title>
		</Dialog.Header>
		<MaintenanceResults {results} />
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button variant="outline" {...props}>Close</Button>
				{/snippet}
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
