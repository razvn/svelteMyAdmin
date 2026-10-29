<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- hrefs are built from db/table names */
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ListTree from '@lucide/svelte/icons/list-tree';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import TableProperties from '@lucide/svelte/icons/table-properties';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import CentralColumnsActions from '#lib/components/table-structure/central-columns-actions.svelte';
	import IndexEditorDialog from '#lib/components/table-structure/index-editor-dialog.svelte';
	import MoveColumnsDialog from '#lib/components/table-structure/move-columns-dialog.svelte';
	import PartitionsCard from '#lib/components/table-structure/partitions-card.svelte';
	import SqlConfirmDialog from '#lib/components/table-structure/sql-confirm-dialog.svelte';
	import StatsCard from '#lib/components/table-structure/stats-card.svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { buildDropColumns } from '#lib/sql/alter-table.ts';
	import { SPATIAL_TYPES, quoteId, hasCollation } from '#lib/sql/column-definition.ts';
	import {
		buildAddKey,
		buildDropIndex,
		buildRenameIndex,
		indexToDef,
		newIndexDef,
		type IndexDef,
		type IndexKind,
		type ParsedIndex
	} from '#lib/sql/index-definition.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t, tn } = useI18n();

	let { data }: PageProps = $props();

	const base = $derived(
		`/db/${encodeURIComponent(data.db)}/table/${encodeURIComponent(data.table)}`
	);
	const readOnly = $derived(data.isView || data.isSystem);
	const columnNames = $derived(data.columns.map((c) => c.def.name));

	// --- key flags per column ---
	const flags = $derived.by(() => {
		const map: Record<string, { primary: boolean; unique: boolean; index: boolean }> = {};
		for (const idx of data.indexes) {
			for (const c of idx.columns) {
				if (c.name === null) continue;
				const f = (map[c.name] ??= { primary: false, unique: false, index: false });
				if (idx.kind === 'PRIMARY') f.primary = true;
				else if (idx.kind === 'UNIQUE') f.unique = true;
				else f.index = true;
			}
		}
		return map;
	});
	const hasPrimary = $derived(data.indexes.some((i) => i.kind === 'PRIMARY'));

	// --- selection ---
	let selectedRaw = $state<string[]>([]);
	const selected = $derived(selectedRaw.filter((n) => columnNames.includes(n)));
	const allChecked = $derived(columnNames.length > 0 && selected.length === columnNames.length);
	function toggle(name: string, checked: boolean) {
		selectedRaw = checked ? [...selected, name] : selected.filter((n) => n !== name);
	}

	// --- confirm dialog ---
	interface Confirm {
		title: string;
		description?: string;
		sql: string;
		action: string;
		payload: unknown;
		label: string;
		destructive?: boolean;
		message: string;
	}
	let confirm = $state<Confirm | null>(null);
	let confirmOpen = $state(false);
	function ask(c: Confirm) {
		confirm = c;
		confirmOpen = true;
	}

	function askDrop(names: string[]) {
		ask({
			title:
				names.length === 1
					? t('Drop column {name}', { name: names[0] })
					: t('Drop {n} columns', { n: names.length }),
			description: t(
				'Do you really want to execute the following query? The data is lost for good.'
			),
			sql: buildDropColumns(data.db, data.table, names),
			action: 'drop',
			payload: { columns: names },
			label: t('Drop'),
			destructive: true,
			message:
				names.length === 1
					? t('Column {name} has been dropped.', { name: names[0] })
					: t('Columns have been dropped.')
		});
	}

	const addKeyTitle = (kind: IndexKind): string =>
		kind === 'PRIMARY'
			? t('Add primary key')
			: kind === 'UNIQUE'
				? t('Add unique index')
				: kind === 'INDEX'
					? t('Add index')
					: kind === 'FULLTEXT'
						? t('Add fulltext index')
						: t('Add spatial index');
	const addKeyDone = (kind: IndexKind): string =>
		kind === 'PRIMARY'
			? t('The primary key has been added.')
			: kind === 'UNIQUE'
				? t('The unique index has been added.')
				: kind === 'INDEX'
					? t('The index has been added.')
					: kind === 'FULLTEXT'
						? t('The fulltext index has been added.')
						: t('The spatial index has been added.');
	function askKey(kind: IndexKind, names: string[]) {
		if (names.length === 0) return;
		const replacePrimary = kind === 'PRIMARY' && hasPrimary;
		ask({
			title: addKeyTitle(kind),
			description: replacePrimary
				? t('The table already has a primary key: it will be dropped and replaced.')
				: undefined,
			sql: buildAddKey(data.db, data.table, kind, names, { replacePrimary }),
			action: 'key',
			payload: { kind, columns: names, replacePrimary },
			label: t('Add'),
			message: addKeyDone(kind)
		});
	}

	const isTextual = (type: string) =>
		/^(CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT)$/.test(type);
	const isSpatial = (type: string) => SPATIAL_TYPES.includes(type);
	const fulltextOk = $derived(
		selected.length > 0 &&
			selected.every((n) => isTextual(data.columns.find((c) => c.def.name === n)?.def.type ?? ''))
	);
	const spatialOk = $derived(
		selected.length > 0 &&
			selected.every((n) => isSpatial(data.columns.find((c) => c.def.name === n)?.def.type ?? ''))
	);

	// --- add columns ---
	let addCount = $state('1');
	let addWhere = $state<'end' | 'first' | 'after'>('end');
	/* svelte-ignore state_referenced_locally */
	let addAfter = $state(data.columns.at(-1)?.def.name ?? '');
	const addHref = $derived.by(() => {
		const q = new SvelteURLSearchParams({
			num: String(Math.max(1, Math.min(64, Number(addCount) || 1))),
			where: addWhere
		});
		if (addWhere === 'after') q.set('after', addAfter);
		return `${base}/structure/add?${q}`;
	});
	const changeHref = (names: string[]) =>
		`${base}/structure/change?${names.map((n) => `field=${encodeURIComponent(n)}`).join('&')}`;
	const distinctHref = (name: string) =>
		`${base}/sql?${new SvelteURLSearchParams({
			sql_query: `SELECT ${quoteId(name)}, COUNT(*) AS cnt FROM ${quoteId(data.table)} GROUP BY ${quoteId(name)} ORDER BY cnt DESC`
		})}`;

	// --- move columns ---
	let moveOpen = $state(false);

	// --- indexes ---
	let editor = $state<{
		original: { name: string; kind: IndexKind } | null;
		initial: IndexDef;
	} | null>(null);
	let editorOpen = $state(false);
	let newIndexParts = $state('1');
	function openEditor(original: ParsedIndex | null, initial: IndexDef) {
		editor = { original: original ? { name: original.name, kind: original.kind } : null, initial };
		editorOpen = true;
	}
	function createIndex() {
		const n = Math.max(1, Math.min(16, Number(newIndexParts) || 1));
		openEditor(
			null,
			newIndexDef({ columns: Array.from({ length: n }, () => ({ name: '', size: '' })) })
		);
	}
	function askDropIndex(idx: ParsedIndex) {
		ask({
			title: t('Drop index {name}', { name: idx.name }),
			sql: buildDropIndex(data.db, data.table, idx.name, idx.kind),
			action: 'dropIndex',
			payload: { name: idx.name },
			label: t('Drop'),
			destructive: true,
			message: t('Index {name} has been dropped.', { name: idx.name })
		});
	}
	let renaming = $state<ParsedIndex | null>(null);
	let renameOpen = $state(false);
	let newName = $state('');
	function startRename(idx: ParsedIndex) {
		renaming = idx;
		newName = '';
		renameOpen = true;
	}
	function askRename() {
		if (!renaming || newName.trim() === '') return;
		const from = renaming.name;
		renameOpen = false;
		ask({
			title: t('Rename index {name}', { name: from }),
			sql: buildRenameIndex(data.db, data.table, from, newName.trim()),
			action: 'renameIndex',
			payload: { from, to: newName.trim() },
			label: t('Rename'),
			message: t('The index has been renamed.')
		});
	}

	const display = (c: (typeof data.columns)[number]): string => {
		const d = c.def;
		if (d.virtuality) return '';
		if (d.defaultType === 'NULL') return 'NULL';
		if (d.defaultType === 'CURRENT_TIMESTAMP') return 'CURRENT_TIMESTAMP';
		if (d.defaultType === 'UUID') return 'uuid()';
		if (d.defaultType === 'USER_DEFINED') return d.defaultValue;
		return d.null ? 'NULL' : 'None';
	};
</script>

<svelte:head><title>{t('Structure')} - {data.table}</title></svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={TableProperties}
		title={t('Structure')}
		description="{data.db}.{data.table} · {tn('{n} column', '{n} columns', data.columns.length)}"
	>
		{#snippet actions()}
			{#if !data.isView}
				<Button variant="outline" href="{base}/relation">
					<ArrowLeftRight class="size-4" />
					{t('Relation view')}
				</Button>
				<Button variant="outline" href="{base}/normalization">{t('Normalize')}</Button>
			{/if}
			<Button variant="outline" href="/transformations">{t('Transformations')}</Button>
			{#if !readOnly}
				<Button
					variant="outline"
					onclick={() => (moveOpen = true)}
					disabled={data.columns.length < 2}
				>
					{t('Move columns')}
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
		<div class="flex min-w-0 flex-col gap-6">
			<Card.Root class="gap-0 py-0">
				<Card.Header class="border-b py-5">
					<Card.Title>{t('Columns')}</Card.Title>
				</Card.Header>
				<Table.Root data-testid="columns-table">
					<Table.Header>
						<Table.Row>
							{#if !readOnly}
								<Table.Head class="w-8">
									<Checkbox
										checked={allChecked}
										onCheckedChange={(v) => (selectedRaw = v === true ? [...columnNames] : [])}
										aria-label={t('Select all columns')}
									/>
								</Table.Head>
							{/if}
							<Table.Head class="w-8">#</Table.Head>
							<Table.Head>{t('Name')}</Table.Head>
							<Table.Head>{t('Type')}</Table.Head>
							<Table.Head>{t('Collation')}</Table.Head>
							<Table.Head>{t('Attributes')}</Table.Head>
							<Table.Head>{t('Null')}</Table.Head>
							<Table.Head>{t('Default')}</Table.Head>
							<Table.Head>{t('Comments')}</Table.Head>
							<Table.Head>{t('Extra')}</Table.Head>
							{#if !readOnly}<Table.Head class="text-end">{t('Action')}</Table.Head>{/if}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.columns as c (c.def.name)}
							{@const f = flags[c.def.name]}
							<Table.Row data-testid="column-row-{c.def.name}">
								{#if !readOnly}
									<Table.Cell>
										<Checkbox
											checked={selected.includes(c.def.name)}
											onCheckedChange={(v) => toggle(c.def.name, v === true)}
											aria-label={t('Select {name}', { name: c.def.name })}
										/>
									</Table.Cell>
								{/if}
								<Table.Cell class="text-muted-foreground">{c.position}</Table.Cell>
								<Table.Cell class="font-mono font-medium">
									<span class="inline-flex items-center gap-1.5">
										{c.def.name}
										{#if f?.primary}
											<KeyRound class="size-3.5 text-warning" aria-label={t('Primary key')} />
										{/if}
										{#if f?.unique}
											<Fingerprint class="size-3.5 text-primary" aria-label={t('Unique')} />
										{/if}
										{#if f?.index}
											<ListTree class="size-3.5 text-muted-foreground" aria-label={t('Indexed')} />
										{/if}
									</span>
								</Table.Cell>
								<Table.Cell class="font-mono text-xs">
									{c.columnType.replace(/\s+(unsigned|zerofill)/gi, '')}
								</Table.Cell>
								<Table.Cell class="text-xs">
									{hasCollation(c.def.type) ? c.def.collation : ''}
								</Table.Cell>
								<Table.Cell class="text-xs">
									{c.def.attribute.toLowerCase()}
								</Table.Cell>
								<Table.Cell>{c.def.null ? t('Yes') : t('No')}</Table.Cell>
								<Table.Cell class="font-mono text-xs">
									{#if display(c) === 'NULL' || display(c) === 'None'}
										<span class="text-muted-foreground italic">{display(c)}</span>
									{:else}
										{display(c)}
									{/if}
								</Table.Cell>
								<Table.Cell class="max-w-48 truncate text-xs" title={c.def.comment}>
									{c.def.comment}
								</Table.Cell>
								<Table.Cell class="text-xs">{c.extra.toUpperCase()}</Table.Cell>
								{#if !readOnly}
									<Table.Cell>
										<div class="flex items-center justify-end gap-0.5">
											<Button
												variant="ghost"
												size="icon-sm"
												href={changeHref([c.def.name])}
												aria-label={t('Change {name}', { name: c.def.name })}
												title={t('Change')}
											>
												<Pencil />
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={t('Drop {name}', { name: c.def.name })}
												title={t('Drop')}
												onclick={() => askDrop([c.def.name])}
											>
												<Trash2 />
											</Button>
											<DropdownMenu.Root>
												<DropdownMenu.Trigger>
													{#snippet child({ props })}
														<Button
															{...props}
															variant="ghost"
															size="icon-sm"
															aria-label={t('More actions for {name}', { name: c.def.name })}
														>
															<MoreHorizontal />
														</Button>
													{/snippet}
												</DropdownMenu.Trigger>
												<DropdownMenu.Content align="end">
													<DropdownMenu.Item
														disabled={f?.primary}
														onclick={() => askKey('PRIMARY', [c.def.name])}
													>
														{t('Primary')}
													</DropdownMenu.Item>
													<DropdownMenu.Item
														disabled={f?.unique}
														onclick={() => askKey('UNIQUE', [c.def.name])}
													>
														{t('Unique')}
													</DropdownMenu.Item>
													<DropdownMenu.Item onclick={() => askKey('INDEX', [c.def.name])}>
														{t('Index')}
													</DropdownMenu.Item>
													<DropdownMenu.Item
														disabled={!isSpatial(c.def.type)}
														onclick={() => askKey('SPATIAL', [c.def.name])}
													>
														{t('Spatial')}
													</DropdownMenu.Item>
													<DropdownMenu.Item
														disabled={!isTextual(c.def.type)}
														onclick={() => askKey('FULLTEXT', [c.def.name])}
													>
														{t('Fulltext')}
													</DropdownMenu.Item>
													<DropdownMenu.Separator />
													<DropdownMenu.Item>
														{#snippet child({ props })}
															<a {...props} href={distinctHref(c.def.name)}
																>{t('Distinct values')}</a
															>
														{/snippet}
													</DropdownMenu.Item>
												</DropdownMenu.Content>
											</DropdownMenu.Root>
										</div>
									</Table.Cell>
								{/if}
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>

				{#if !readOnly}
					<div class="flex flex-wrap items-center gap-2 border-t p-4" data-testid="column-toolbar">
						<span class="text-sm text-muted-foreground">{t('With selected:')}</span>
						<Button
							variant="outline"
							size="sm"
							href={selected.length ? changeHref(selected) : undefined}
							disabled={selected.length === 0}
						>
							{t('Change')}
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={selected.length === 0}
							onclick={() => askDrop(selected)}
						>
							{t('Drop')}
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={selected.length === 0}
							onclick={() => askKey('PRIMARY', selected)}
						>
							{t('Primary')}
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={selected.length === 0}
							onclick={() => askKey('UNIQUE', selected)}
						>
							{t('Unique')}
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={selected.length === 0}
							onclick={() => askKey('INDEX', selected)}
						>
							{t('Index')}
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={!spatialOk}
							onclick={() => askKey('SPATIAL', selected)}
						>
							{t('Spatial')}
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={!fulltextOk}
							onclick={() => askKey('FULLTEXT', selected)}
						>
							{t('Fulltext')}
						</Button>
						{#if data.centralAvailable}
							<CentralColumnsActions {selected} />
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-2 border-t p-4" data-testid="add-columns">
						<Plus class="size-4 text-muted-foreground" aria-hidden="true" />
						<span class="text-sm">{t('Add')}</span>
						<Input
							type="number"
							min={1}
							max={64}
							bind:value={addCount}
							aria-label={t('Number of columns to add')}
							class="w-20"
						/>
						<span class="text-sm">{t('column(s)')}</span>
						<Select.Root type="single" bind:value={addWhere}>
							<Select.Trigger class="w-48" aria-label={t('Position of the new columns')}>
								{addWhere === 'end'
									? t('at end of table')
									: addWhere === 'first'
										? t('at beginning of table')
										: t('after')}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="end" label={t('at end of table')}
									>{t('at end of table')}</Select.Item
								>
								<Select.Item value="first" label={t('at beginning of table')}>
									{t('at beginning of table')}
								</Select.Item>
								<Select.Item value="after" label={t('after')}>{t('after')}</Select.Item>
							</Select.Content>
						</Select.Root>
						{#if addWhere === 'after'}
							<Select.Root type="single" bind:value={addAfter}>
								<Select.Trigger class="w-48" aria-label={t('Add after column')}>
									<span class="truncate font-mono">{addAfter}</span>
								</Select.Trigger>
								<Select.Content class="max-h-72">
									{#each columnNames as n (n)}
										<Select.Item value={n} label={n}>{n}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						{/if}
						<Button href={addHref} size="sm">{t('Go')}</Button>
					</div>
				{/if}
			</Card.Root>

			{#if !data.isView}
				<Card.Root class="gap-0 py-0" id="indexes" data-testid="indexes-card">
					<Card.Header class="border-b py-5">
						<Card.Title>{t('Indexes')}</Card.Title>
					</Card.Header>
					{#if data.indexes.length === 0}
						<Card.Content class="py-5 text-sm text-muted-foreground">
							{t('No index defined!')}
						</Card.Content>
					{:else}
						<Table.Root data-testid="indexes-table">
							<Table.Header>
								<Table.Row>
									{#if !readOnly}<Table.Head>{t('Action')}</Table.Head>{/if}
									<Table.Head>{t('Keyname')}</Table.Head>
									<Table.Head>{t('Type')}</Table.Head>
									<Table.Head>{t('Unique')}</Table.Head>
									<Table.Head>{t('Packed')}</Table.Head>
									<Table.Head>{t('Column')}</Table.Head>
									<Table.Head class="text-end">{t('Cardinality')}</Table.Head>
									<Table.Head>{t('Collation')}</Table.Head>
									<Table.Head>{t('Null')}</Table.Head>
									<Table.Head>{t('Comment')}</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each data.indexes as idx (idx.name)}
									<Table.Row data-testid="index-row-{idx.name}" class="align-top">
										{#if !readOnly}
											<Table.Cell>
												<div class="flex items-center gap-0.5">
													<Button
														variant="ghost"
														size="icon-sm"
														aria-label={t('Edit index {name}', { name: idx.name })}
														title={idx.editable
															? t('Edit')
															: t('Functional indexes cannot be edited here')}
														disabled={!idx.editable}
														onclick={() => openEditor(idx, indexToDef(idx))}
													>
														<Pencil />
													</Button>
													{#if data.canRenameIndex && idx.kind !== 'PRIMARY'}
														<Button
															variant="ghost"
															size="sm"
															aria-label={t('Rename index {name}', { name: idx.name })}
															onclick={() => startRename(idx)}
														>
															{t('Rename')}
														</Button>
													{/if}
													<Button
														variant="ghost"
														size="icon-sm"
														aria-label={t('Drop index {name}', { name: idx.name })}
														title={t('Drop')}
														onclick={() => askDropIndex(idx)}
													>
														<Trash2 />
													</Button>
												</div>
											</Table.Cell>
										{/if}
										<Table.Cell class="font-mono font-medium">
											{idx.name}
											{#if !idx.visible}
												<Badge variant="secondary">{data.invisibleLabel.toLowerCase()}</Badge>
											{/if}
										</Table.Cell>
										<Table.Cell class="text-xs">{idx.indexType}</Table.Cell>
										<Table.Cell>{idx.unique ? t('Yes') : t('No')}</Table.Cell>
										<Table.Cell>{idx.packed ?? t('No')}</Table.Cell>
										<Table.Cell class="font-mono text-xs">
											{#each idx.columns as c, i (i)}
												<div>
													{c.name ?? c.expression}{c.subPart ? ` (${c.subPart})` : ''}
												</div>
											{/each}
										</Table.Cell>
										<Table.Cell class="text-end text-xs tabular-nums">
											{#each idx.columns as c, i (i)}
												<div>{c.cardinality ?? ''}</div>
											{/each}
										</Table.Cell>
										<Table.Cell class="text-xs">
											{#each idx.columns as c, i (i)}
												<div>{c.collation === 'A' ? 'A' : c.collation === 'D' ? 'D' : ' '}</div>
											{/each}
										</Table.Cell>
										<Table.Cell class="text-xs">
											{#each idx.columns as c, i (i)}
												<div>{c.nullable ? t('Yes') : t('No')}</div>
											{/each}
										</Table.Cell>
										<Table.Cell class="text-xs">{idx.indexComment || idx.comment}</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					{/if}
					{#if !readOnly}
						<div class="flex flex-wrap items-center gap-2 border-t p-4">
							<span class="text-sm">{t('Create an index on')}</span>
							<Input
								type="number"
								min={1}
								max={16}
								bind:value={newIndexParts}
								aria-label={t('Number of index columns')}
								class="w-20"
							/>
							<span class="text-sm">{t('columns')}</span>
							<Button size="sm" onclick={createIndex}>{t('Go')}</Button>
						</div>
					{/if}
				</Card.Root>

				<PartitionsCard partitions={data.partitions} />
			{/if}
		</div>

		{#if data.stats}
			<StatsCard stats={data.stats} />
		{/if}
	</div>
</div>

{#if confirm}
	<SqlConfirmDialog bind:open={confirmOpen} {...confirm} />
{/if}

{#if editor && editorOpen}
	<IndexEditorDialog
		bind:open={editorOpen}
		original={editor.original}
		initial={editor.initial}
		tableColumns={columnNames}
		caps={data.caps}
		db={data.db}
		table={data.table}
		canInvisible={data.canInvisible}
		invisibleLabel={data.invisibleLabel}
	/>
{/if}

{#if moveOpen}
	<MoveColumnsDialog
		bind:open={moveOpen}
		columns={data.columns.map((c) => c.def)}
		caps={data.caps}
		db={data.db}
		table={data.table}
	/>
{/if}

<Dialog.Root bind:open={renameOpen}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>{t('Rename index {name}', { name: renaming?.name ?? '' })}</Dialog.Title>
		</Dialog.Header>
		<Input
			bind:value={newName}
			placeholder={t('New index name')}
			maxlength={64}
			autocomplete="off"
		/>
		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (renameOpen = false)}
				>{t('Cancel')}</Button
			>
			<Button type="button" disabled={newName.trim() === ''} onclick={askRename}
				>{t('Preview SQL')}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
