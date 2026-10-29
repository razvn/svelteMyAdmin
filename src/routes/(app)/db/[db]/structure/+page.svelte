<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- hrefs are built from db/table names or page.url.pathname plus a query string */
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Copy from '@lucide/svelte/icons/copy';
	import Eraser from '@lucide/svelte/icons/eraser';
	import Eye from '@lucide/svelte/icons/eye';
	import HardDrive from '@lucide/svelte/icons/hard-drive';
	import Rows3 from '@lucide/svelte/icons/rows-3';
	import Search from '@lucide/svelte/icons/search';
	import SquarePlus from '@lucide/svelte/icons/square-plus';
	import Table2 from '@lucide/svelte/icons/table-2';
	import TableProperties from '@lucide/svelte/icons/table-properties';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Wrench from '@lucide/svelte/icons/wrench';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import StatCard from '#lib/components/app-shell/stat-card.svelte';
	import MaintenanceResults from '#lib/components/database/maintenance-results.svelte';
	import { getNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import FavoriteStar from '#lib/components/table/favorite-star.svelte';
	import { N_, useI18n } from '#lib/i18n/index.ts';
		import type { PageProps } from './$types';
	const { t, tn, fmt } = useI18n();

	type Op =
		| 'empty'
		| 'drop'
		| 'check'
		| 'optimize'
		| 'repair'
		| 'analyze'
		| 'checksum'
		| 'add_prefix'
		| 'replace_prefix'
		| 'copy_prefix'
		| 'show_create';
	type ResultSet = { statement: string; rows: Record<string, string>[] };

	let { data }: PageProps = $props();
	const navState = getNavState();

	const OP_LABELS: Record<Op, string> = {
		empty: N_('Empty'),
		drop: N_('Drop'),
		check: N_('Check table'),
		optimize: N_('Optimize table'),
		repair: N_('Repair table'),
		analyze: N_('Analyze table'),
		checksum: N_('Checksum table'),
		add_prefix: N_('Add prefix to table'),
		replace_prefix: N_('Replace table prefix'),
		copy_prefix: N_('Copy table with prefix'),
		show_create: N_('Show create')
	};

	let filter = $state('');
	let selected = $state<string[]>([]);
	let opChoice = $state('');

	// operation in progress
	let op = $state<Op>('check');
	let targets = $state<string[]>([]);
	let fkChecks = $state(true);
	let prefix = $state('');
	let fromPrefix = $state('');
	let toPrefix = $state('');
	let dropIfExists = $state(false);

	let prefixOpen = $state(false);
	let confirmOpen = $state(false);
	let resultsOpen = $state(false);
	let busy = $state(false);
	let statements = $state<string[]>([]);
	let results = $state.raw<ResultSet[]>([]);
	let errorMsg = $state('');
	let dialogError = $state('');

	let previewForm = $state<HTMLFormElement>();
	let runForm = $state<HTMLFormElement>();

	const visible = $derived(
		data.rows.filter((tbl) => tbl.name.toLowerCase().includes(filter.trim().toLowerCase()))
	);
	const visibleNames = $derived(visible.map((tbl) => tbl.name));
	const allChecked = $derived(
		visibleNames.length > 0 && visibleNames.every((n) => selected.includes(n))
	);
	const sumSize = $derived(fmt.byteDown(data.sums.size, 3, 1));
	const sumOverhead = $derived(
		fmt.byteDown(data.sums.overhead, 3, data.sums.overhead > 0 ? 1 : 0)
	);
	const hasOverhead = $derived(data.rows.some((tbl) => tbl.overhead > 0));

	const prefixOps: Op[] = ['add_prefix', 'replace_prefix', 'copy_prefix'];

	function href(params: Record<string, string | number | null>): string {
		const u = new SvelteURLSearchParams();
		const merged: Record<string, string | number | null> = {
			sort: data.sort === 'name' ? null : data.sort,
			sort_order: data.sortOrder === 'asc' ? null : data.sortOrder,
			pos: data.pos || null,
			...params
		};
		for (const [k, v] of Object.entries(merged)) if (v !== null) u.set(k, String(v));
		const qs = u.toString();
		return qs ? `${page.url.pathname}?${qs}` : page.url.pathname;
	}

	function sortHref(col: string): string {
		const order = data.sort === col && data.sortOrder === 'asc' ? 'desc' : 'asc';
		return href({ sort: col, sort_order: order, pos: null });
	}

	function toggleAll(checked: boolean) {
		selected = checked
			? [...new Set([...selected, ...visibleNames])]
			: selected.filter((n) => !visibleNames.includes(n));
	}

	function toggle(name: string, checked: boolean) {
		selected = checked ? [...selected, name] : selected.filter((n) => n !== name);
	}

	const tableHref = (name: string, tab: string) =>
		`/db/${encodeURIComponent(data.db)}/table/${encodeURIComponent(name)}/${tab}`;

	async function startOp(next: Op, list: string[]) {
		if (list.length === 0) return;
		op = next;
		targets = list;
		errorMsg = '';
		dialogError = '';
		fkChecks = true;
		if (prefixOps.includes(next)) {
			prefixOpen = true;
			return;
		}
		// let the hidden inputs pick up the new state before submitting
		await tick();
		if (next === 'empty' || next === 'drop') {
			previewForm?.requestSubmit();
		} else {
			runForm?.requestSubmit();
		}
	}

	function onChoose(value: string) {
		if (value) startOp(value as Op, [...selected]);
		opChoice = '';
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(t('Copied to clipboard.'));
		} catch {
			toast.error(t('Could not copy.'));
		}
	}

	const createSql = (r: Record<string, string>) => r['Create Table'] ?? r['Create View'] ?? '';
	const createName = (r: Record<string, string>) => r['Table'] ?? r['View'] ?? '';
</script>

{#snippet sortMark(col: string)}
	{#if data.sort === col}
		{#if data.sortOrder === 'asc'}
			<ArrowUp class="size-3.5" aria-label={t('Ascending')} />
		{:else}
			<ArrowDown class="size-3.5" aria-label={t('Descending')} />
		{/if}
	{/if}
{/snippet}

{#snippet sortHeader(col: string, title: string)}
	<a href={sortHref(col)} class="inline-flex items-center gap-1 hover:underline">
		{title}
		{@render sortMark(col)}
	</a>
{/snippet}

{#snippet hiddenFields()}
	<input type="hidden" name="op" value={op} />
	{#each targets as name (name)}
		<input type="hidden" name="selected" value={name} />
	{/each}
	<input type="hidden" name="fk_checks" value={fkChecks ? '1' : '0'} />
	<input type="hidden" name="prefix" value={prefix} />
	<input type="hidden" name="from_prefix" value={fromPrefix} />
	<input type="hidden" name="to_prefix" value={toPrefix} />
	<input type="hidden" name="drop_if_exists" value={dropIfExists ? '1' : '0'} />
{/snippet}

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Table2}
		title={t('Structure')}
		description="{data.db} · {tn('{n} table', '{n} tables', data.total)}"
	>
		{#snippet actions()}
			<Button variant="outline" href="/db/{encodeURIComponent(data.db)}/data-dictionary">
				<BookOpen class="size-4" /> {t('Data dictionary')}
			</Button>
		{/snippet}
	</PageHeader>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<StatCard
			label={t('Tables')}
			value={fmt.number(data.sums.tables)}
			icon={Table2}
			data-testid="stat-tables"
		/>
		<StatCard
			label={t('Rows')}
			value="{data.sums.approxRows ? '~' : ''}{fmt.number(data.sums.rows)}"
			icon={Rows3}
			tone="info"
			data-testid="stat-rows"
		/>
		{#if data.showStats}
			<StatCard
				label={t('Total size')}
				value={sumSize ? `${sumSize[0]} ${sumSize[1]}` : '0 B'}
				icon={HardDrive}
				tone="success"
				data-testid="stat-size"
			/>
			<StatCard
				label={t('Overhead')}
				value={sumOverhead ? `${sumOverhead[0]} ${sumOverhead[1]}` : '0 B'}
				icon={Wrench}
				tone={data.sums.overhead > 0 ? 'warning' : 'primary'}
				data-testid="stat-overhead"
			/>
		{/if}
	</div>

	{#if errorMsg}
		<Alert variant="destructive" role="alert">
			<AlertDescription>{errorMsg}</AlertDescription>
		</Alert>
	{/if}

	{#if data.total === 0}
		<Alert><AlertDescription>{t('No tables found in database.')}</AlertDescription></Alert>
	{:else}
		<Card.Root class="gap-0 py-0">
			<div class="flex flex-wrap items-center gap-3 border-b p-5">
				<Checkbox
					id="check-all"
					checked={allChecked}
					onCheckedChange={(v) => toggleAll(v === true)}
					aria-label={t('Check all')}
				/>
				<label for="check-all" class="text-sm">{t('Check all')}</label>
				<Select.Root
					type="single"
					bind:value={opChoice}
					onValueChange={onChoose}
					disabled={selected.length === 0}
				>
					<Select.Trigger class="w-56" aria-label={t('With selected')} data-testid="bulk-op">
						{t('With selected:')}
					</Select.Trigger>
					<Select.Content class="max-h-96">
						<Select.Item value="show_create" label={t(OP_LABELS.show_create)}>
							{t(OP_LABELS.show_create)}
						</Select.Item>
						{#if !data.isSystem}
							<Select.Group>
								<Select.GroupHeading>{t('Delete data or table')}</Select.GroupHeading>
								<Select.Item value="empty" label={t(OP_LABELS.empty)}>{t(OP_LABELS.empty)}</Select.Item>
								<Select.Item value="drop" label={t(OP_LABELS.drop)}>{t(OP_LABELS.drop)}</Select.Item>
							</Select.Group>
						{/if}
						<Select.Group>
							<Select.GroupHeading>{t('Table maintenance')}</Select.GroupHeading>
							{#each ['analyze', 'check', 'checksum', 'optimize', 'repair'] as const as m (m)}
								{#if !data.isSystem || m === 'check' || m === 'checksum'}
									<Select.Item value={m} label={t(OP_LABELS[m])}>{t(OP_LABELS[m])}</Select.Item>
								{/if}
							{/each}
						</Select.Group>
						{#if !data.isSystem}
							<Select.Group>
								<Select.GroupHeading>{t('Prefix')}</Select.GroupHeading>
								{#each prefixOps as p (p)}
									<Select.Item value={p} label={t(OP_LABELS[p])}>{t(OP_LABELS[p])}</Select.Item>
								{/each}
							</Select.Group>
						{/if}
					</Select.Content>
				</Select.Root>
				{#if hasOverhead && !data.isSystem}
					<Button
						variant="link"
						size="sm"
						onclick={() => (selected = data.rows.filter((tbl) => tbl.overhead > 0).map((tbl) => tbl.name))}
					>
						{t('Check tables having overhead')}
					</Button>
				{/if}
				<Input
					bind:value={filter}
					type="search"
					placeholder={t('Filter tables')}
					aria-label={t('Filter tables')}
					class="ml-auto w-56"
				/>
			</div>

			{#if data.maxTableList > 0 && data.total > data.maxTableList}
				<nav class="flex items-center gap-2 border-b px-5 py-3 text-sm" aria-label={t('Pagination')}>
					<Button variant="outline" size="sm" href={href({ pos: null })} disabled={data.pos === 0}>
						{t('Start')}
					</Button>
					<Button
						variant="outline"
						size="sm"
						href={href({ pos: Math.max(0, data.pos - data.maxTableList) || null })}
						disabled={data.pos === 0}
					>
						{t('Previous')}
					</Button>
					<span class="text-muted-foreground">
						{t('Showing {from} - {to} of {total}', { from: data.pos + 1, to: Math.min(data.total, data.pos + data.maxTableList), total: data.total })}
					</span>
					<Button
						variant="outline"
						size="sm"
						href={href({ pos: data.pos + data.maxTableList })}
						disabled={data.pos + data.maxTableList >= data.total}
					>
						{t('Next')}
					</Button>
				</nav>
			{/if}

			<Table.Root data-testid="structure-table">
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-8"></Table.Head>
						<Table.Head>{@render sortHeader('name', t('Table'))}</Table.Head>
						<Table.Head class="text-center">{t('Action')}</Table.Head>
						<Table.Head class="text-end">{@render sortHeader('rows', t('Rows'))}</Table.Head>
						<Table.Head>{@render sortHeader('engine', t('Type'))}</Table.Head>
						<Table.Head>{@render sortHeader('collation', t('Collation'))}</Table.Head>
						{#if data.showStats}
							<Table.Head class="text-end">{@render sortHeader('size', t('Size'))}</Table.Head>
							<Table.Head class="text-end">{@render sortHeader('overhead', t('Overhead'))}</Table.Head>
						{/if}
						<Table.Head>{@render sortHeader('comment', t('Comment'))}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each visible as tbl (tbl.name)}
						{@const size = tbl.size === null ? null : fmt.byteDown(tbl.size, 3, tbl.size > 0 ? 1 : 0)}
						{@const over = tbl.overhead > 0 ? fmt.byteDown(tbl.overhead, 3, 1) : null}
						<Table.Row data-testid="table-row-{tbl.name}">
							<Table.Cell>
								<Checkbox
									checked={selected.includes(tbl.name)}
									onCheckedChange={(v) => toggle(tbl.name, v === true)}
									aria-label={t('Select {name}', { name: tbl.name })}
								/>
							</Table.Cell>
							<Table.Cell class="font-mono">
								<div class="flex items-center gap-1">
									<a
										href={tableHref(tbl.name, 'browse')}
										class="font-medium text-foreground hover:text-primary hover:underline"
										title={tbl.comment}
									>
										{tbl.name}
									</a>
									<FavoriteStar db={data.db} table={tbl.name} class="size-6" />
								</div>
							</Table.Cell>
							<Table.Cell>
								<div class="flex items-center justify-center gap-0.5">
									<Button
										variant="ghost"
										size="icon-sm"
										href={tableHref(tbl.name, 'browse')}
										aria-label={t('Browse {name}', { name: tbl.name })}
										title={t('Browse')}
									>
										<Eye />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										href={tableHref(tbl.name, 'structure')}
										aria-label={t('Structure of {name}', { name: tbl.name })}
										title={t('Structure')}
									>
										<TableProperties />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										href={tableHref(tbl.name, 'search')}
										aria-label={t('Search {name}', { name: tbl.name })}
										title={t('Search')}
									>
										<Search />
									</Button>
									{#if !data.isSystem}
										<Button
											variant="ghost"
											size="icon-sm"
											href={tableHref(tbl.name, tbl.isView ? 'structure' : 'insert')}
											aria-label={tbl.isView
												? t('Edit {name}', { name: tbl.name })
												: t('Insert into {name}', { name: tbl.name })}
											title={tbl.isView ? t('Edit') : t('Insert')}
										>
											<SquarePlus />
										</Button>
										{#if !tbl.isView}
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={t('Empty {name}', { name: tbl.name })}
												title={t('Empty')}
												onclick={() => startOp('empty', [tbl.name])}
											>
												<Eraser />
											</Button>
										{/if}
										<Button
											variant="ghost"
											size="icon-sm"
											class="text-destructive"
											aria-label={t('Drop {name}', { name: tbl.name })}
											title={t('Drop')}
											onclick={() => startOp('drop', [tbl.name])}
										>
											<Trash2 />
										</Button>
									{/if}
								</div>
							</Table.Cell>
							{#if tbl.inUse}
								<Table.Cell
									colspan={data.showStats ? 6 : 4}
									class="text-center text-muted-foreground">{t('in use')}</Table.Cell
								>
							{:else}
								<Table.Cell class="text-end tabular-nums" data-testid="rows-{tbl.name}">
									{#if tbl.rows === null}
										-
									{:else}
										{tbl.approx ? '~' : ''}{fmt.number(tbl.rows)}
									{/if}
									{#if tbl.viewHint}
										<span
											class="text-muted-foreground"
											title={t('This view has at least this number of rows.')}>*</span
										>
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if tbl.isView}
										<Badge variant="info">{t('View')}</Badge>
									{:else if tbl.engine}
										{tbl.engine}
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if tbl.collation}<Badge variant="muted">{tbl.collation}</Badge>{:else}---{/if}
								</Table.Cell>
								{#if data.showStats}
									<Table.Cell class="text-end tabular-nums">
										{#if size}{size[0]}
											<span class="text-muted-foreground">{size[1]}</span>{:else}-{/if}
									</Table.Cell>
									<Table.Cell class="text-end tabular-nums">
										{#if over}
											<Badge variant="warning">{over[0]} {over[1]}</Badge>
										{:else}-{/if}
									</Table.Cell>
								{/if}
								<Table.Cell class="whitespace-normal text-muted-foreground">{tbl.comment}</Table.Cell>
							{/if}
						</Table.Row>
					{/each}
				</Table.Body>
				<Table.Footer>
					<Table.Row>
						<Table.Cell colspan={3} class="font-semibold">
							<span data-testid="table-count">{data.total}</span>
							{tn('table', 'tables', data.total)}
						</Table.Cell>
						<Table.Cell class="text-end font-semibold tabular-nums">
							{t('Sum')}: {data.sums.approxRows ? '~' : ''}{fmt.number(data.sums.rows)}
						</Table.Cell>
						<Table.Cell></Table.Cell>
						<Table.Cell></Table.Cell>
						{#if data.showStats}
							<Table.Cell class="text-end font-semibold tabular-nums">
								{sumSize ? `${sumSize[0]} ${sumSize[1]}` : ''}
							</Table.Cell>
							<Table.Cell class="text-end font-semibold tabular-nums">
								{data.sums.overhead > 0 && sumOverhead ? `${sumOverhead[0]} ${sumOverhead[1]}` : ''}
							</Table.Cell>
						{/if}
						<Table.Cell></Table.Cell>
					</Table.Row>
				</Table.Footer>
			</Table.Root>
		</Card.Root>
	{/if}

	{#if !data.isSystem}
		<Card.Root>
			<Card.Header><Card.Title>{t('Create new table')}</Card.Title></Card.Header>
			<Card.Content>
				<form
					method="GET"
					action="/db/{encodeURIComponent(data.db)}/create-table"
					class="flex flex-wrap items-end gap-3"
				>
					<div class="flex flex-col gap-1.5">
						<label for="new-table-name" class="text-sm">{t('Table name')}</label>
						<Input id="new-table-name" name="name" required maxlength={64} class="w-64" />
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="new-table-cols" class="text-sm">{t('Number of columns')}</label>
						<Input
							id="new-table-cols"
							name="num_fields"
							type="number"
							min="1"
							max="4096"
							value="4"
							required
							class="w-32"
						/>
					</div>
					<Button type="submit">{t('Create')}</Button>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<!-- hidden forms driven by startOp() -->
<form
	bind:this={previewForm}
	method="POST"
	action="?/preview"
	class="hidden"
	use:enhance={() => {
		busy = true;
		return async ({ result }) => {
			busy = false;
			if (result.type === 'success') {
				const p = result.data?.preview as { statements: string[] };
				statements = p.statements;
				confirmOpen = true;
			} else if (result.type === 'failure') {
				errorMsg = String(result.data?.error ?? t('Could not prepare the operation.'));
				toast.error(errorMsg);
			}
		};
	}}
>
	{@render hiddenFields()}
</form>
<form
	bind:this={runForm}
	method="POST"
	action="?/run"
	class="hidden"
	use:enhance={() => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				const done = result.data?.done as { op: Op; results: ResultSet[]; count: number };
				confirmOpen = false;
				prefixOpen = false;
				if (
					done.op === 'show_create' ||
					['check', 'optimize', 'repair', 'analyze', 'checksum'].includes(done.op)
				) {
					results = done.results;
					resultsOpen = true;
				} else {
					toast.success(
						t('{operation}: done ({count}).', { operation: t(OP_LABELS[done.op]), count: done.count })
					);
				}
				const mutated = !['show_create', 'check', 'checksum'].includes(done.op);
				if (['empty', 'drop', 'add_prefix', 'replace_prefix', 'copy_prefix'].includes(done.op)) {
					selected = [];
				}
				await update({ reset: false });
				if (mutated) await navState.reload();
			} else if (result.type === 'failure') {
				const msg = String(result.data?.error ?? t('The operation failed.'));
				confirmOpen = false;
				if (prefixOpen) dialogError = msg;
				else errorMsg = msg;
				toast.error(msg);
				await update({ reset: false });
			}
		};
	}}
>
	{@render hiddenFields()}
</form>

<!-- prefix input dialog; "Continue" shows the SQL for confirmation -->
<Dialog.Root bind:open={prefixOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{t(OP_LABELS[op])}</Dialog.Title>
			<Dialog.Description>
				{tn('{n} table selected.', '{n} tables selected.', targets.length)}
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-3">
			{#if op === 'add_prefix'}
				<label class="flex flex-col gap-1.5 text-sm">
					{t('Add prefix')}
					<Input bind:value={prefix} name="prefix_input" maxlength={64} aria-label={t('Prefix')} />
				</label>
			{:else}
				<label class="flex flex-col gap-1.5 text-sm">
					{op === 'copy_prefix' ? t('From prefix') : t('Replace prefix')}
					<Input bind:value={fromPrefix} maxlength={64} aria-label={t('From prefix')} />
				</label>
				<label class="flex flex-col gap-1.5 text-sm">
					{t('With')}
					<Input bind:value={toPrefix} maxlength={64} aria-label={t('To prefix')} />
				</label>
			{/if}
			{#if op === 'copy_prefix'}
				<div class="flex items-center gap-2">
					<Checkbox
						id="drop-if-exists"
						checked={dropIfExists}
						onCheckedChange={(v) => (dropIfExists = v === true)}
					/>
					<label for="drop-if-exists" class="text-sm">{t('Add DROP TABLE IF EXISTS')}</label>
				</div>
			{/if}
			{#if dialogError}
				<p class="text-sm text-destructive" role="alert">{dialogError}</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (prefixOpen = false)}>{t('Cancel')}</Button>
			<Button
				disabled={busy}
				onclick={() => {
					dialogError = '';
					previewForm?.requestSubmit();
				}}>{t('Continue')}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- confirmation showing the SQL -->
<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content class="sm:max-w-xl">
		<AlertDialog.Header>
			<AlertDialog.Title>{t('Do you really want to execute the following query?')}</AlertDialog.Title>
			<AlertDialog.Description>{t('This cannot be undone.')}</AlertDialog.Description>
		</AlertDialog.Header>
		<pre
			class="max-h-60 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
			data-testid="confirm-sql">{statements.join(';\n')};</pre>
		{#if op === 'drop' || op === 'empty'}
			<div class="flex items-center gap-2">
				<Checkbox
					id="fk-checks"
					checked={fkChecks}
					onCheckedChange={(v) => (fkChecks = v === true)}
				/>
				<label for="fk-checks" class="text-sm">{t('Enable foreign key checks')}</label>
			</div>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{t('Cancel')}</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				disabled={busy}
				onclick={(e: MouseEvent) => {
					e.preventDefault();
					runForm?.requestSubmit();
				}}
			>
				{t('Yes')}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- result of maintenance / show create -->
<Dialog.Root bind:open={resultsOpen}>
	<Dialog.Content class="max-h-[85vh] overflow-auto sm:max-w-3xl" data-testid="results-dialog">
		<Dialog.Header>
			<Dialog.Title>{t(OP_LABELS[op])}</Dialog.Title>
		</Dialog.Header>
		{#each results as r (r.statement)}
			{#if op === 'show_create'}
				{#each r.rows as row (createName(row))}
					<div class="flex flex-col gap-2">
						<div class="flex items-center justify-between gap-2">
							<span class="font-mono text-sm font-medium">{createName(row)}</span>
							<Button variant="outline" size="sm" onclick={() => copy(createSql(row))}>
								<Copy /> {t('Copy')}
							</Button>
						</div>
						<pre class="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{createSql(
								row
							)}</pre>
					</div>
				{/each}
			{:else}
				<MaintenanceResults results={[r]} />
			{/if}
		{/each}
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button variant="outline" {...props}>{t('Close')}</Button>
				{/snippet}
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
