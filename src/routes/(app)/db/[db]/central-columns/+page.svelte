<script lang="ts">
	import { enhance } from '$app/forms';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import Pencil from '@lucide/svelte/icons/pencil';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import ColumnEditor from '#lib/components/columns/column-editor.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { newColumn, type ColumnDef } from '#lib/sql/column-definition.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t, tn } = useI18n();

	let { data, form }: PageProps = $props();

	const base = $derived(`/db/${encodeURIComponent(data.db)}/central-columns`);

	/* The route data only seeds the forms; the user's edits live in local state. */
	let newCol = $state<ColumnDef[]>([newColumn()]);
	let selected = $state<string[]>([]);
	let picked = $state<string[]>([]);
	let editing = $state<{ original: string; columns: ColumnDef[] } | null>(null);

	function edit(i: number) {
		if (data.available) {
			editing = {
				original: data.columns[i].name,
				columns: [structuredClone($state.snapshot(data.editable[i]))]
			};
		}
	}

	const toggle = (list: string[], name: string, on: boolean) =>
		on ? [...list.filter((n) => n !== name), name] : list.filter((n) => n !== name);

	const pageHref = (pos: number) => {
		const p = new SvelteURLSearchParams();
		if (data.available && data.filter) p.set('q', data.filter);
		if (pos > 0) p.set('pos', String(pos));
		const s = p.toString();
		return s ? `${base}?${s}` : base;
	};

	const message = $derived(form && 'message' in form ? String(form.message) : '');
	const error = $derived(form && 'error' in form ? String(form.error) : '');
</script>

<svelte:head><title>{t('Central columns')} - {data.db}</title></svelte:head>

<div class="flex flex-col gap-6" data-testid="central-columns">
	<PageHeader
		icon={Columns3}
		title={t('Central columns')}
		description={t('Reusable column definitions of database {db}.', { db: data.db })}
	/>

	{#if message}
		<Alert.Root role="status" data-testid="central-message"
			><Alert.Title>{message}</Alert.Title></Alert.Root
		>
	{/if}
	{#if error}
		<Alert.Root variant="destructive" role="alert" data-testid="central-error">
			<Alert.Title>{error}</Alert.Title>
		</Alert.Root>
	{/if}

	{#if !data.available}
		<Alert.Root role="status" data-testid="central-disabled">
			<Alert.Title>{t('The central list of columns is not available')}</Alert.Title>
			<Alert.Description>
				{t('The central_columns table of the configuration storage is not configured or not reachable.')}
			</Alert.Description>
		</Alert.Root>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Columns in the central list')}</Card.Title>
				<Card.Description>{tn('{n} column', '{n} columns', data.total)}</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<form method="GET" action={base} class="flex items-center gap-2">
					<Input
						name="q"
						value={data.filter}
						placeholder={t('Filter by column name')}
						aria-label={t('Filter central columns')}
						class="max-w-xs"
					/>
					<Button type="submit" variant="outline">{t('Filter')}</Button>
				</form>

				<form
					method="POST"
					action="?/delete"
					use:enhance={() =>
						async ({ update }) => {
							await update();
							selected = [];
						}}
					class="flex flex-col gap-3"
				>
					{#each selected as name (name)}
						<input type="hidden" name="column" value={name} />
					{/each}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head class="w-8"></Table.Head>
								<Table.Head>{t('Name')}</Table.Head>
								<Table.Head>{t('Type')}</Table.Head>
								<Table.Head>{t('Length/Values')}</Table.Head>
								<Table.Head>{t('Collation')}</Table.Head>
								<Table.Head>{t('Null')}</Table.Head>
								<Table.Head>{t('Extra')}</Table.Head>
								<Table.Head>{t('Default')}</Table.Head>
								<Table.Head class="w-12"></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.columns as c, i (c.name)}
								<Table.Row data-testid="central-row-{c.name}">
									<Table.Cell>
										<Checkbox
											aria-label={t('Select {name}', { name: c.name })}
											checked={selected.includes(c.name)}
											onCheckedChange={(v) => (selected = toggle(selected, c.name, v === true))}
										/>
									</Table.Cell>
									<Table.Cell class="font-mono font-medium">{c.name}</Table.Cell>
									<Table.Cell class="font-mono">
										{c.type}{c.attribute ? ` ${c.attribute.toLowerCase()}` : ''}
									</Table.Cell>
									<Table.Cell class="font-mono">{c.length}</Table.Cell>
									<Table.Cell>{c.collation}</Table.Cell>
									<Table.Cell>{c.isNull ? t('Yes') : t('No')}</Table.Cell>
									<Table.Cell>{c.extra}</Table.Cell>
									<Table.Cell class="font-mono">{c.default}</Table.Cell>
									<Table.Cell>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={t('Edit {name}', { name: c.name })}
											onclick={() => edit(i)}
										>
											<Pencil />
										</Button>
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell colspan={9} class="text-center text-muted-foreground">
										{t('No columns in the central list.')}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<Button
							type="submit"
							variant="destructive"
							disabled={!hydration.ready || selected.length === 0}
						>
							{t('Delete selected')}
						</Button>
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							{#if data.pos > 0}
								<Button
									variant="outline"
									size="sm"
									href={pageHref(Math.max(0, data.pos - data.size))}
								>
									{t('Previous')}
								</Button>
							{/if}
							<span>
								{t('{from}-{to} of {total}', {
									from: data.total === 0 ? 0 : data.pos + 1,
									to: Math.min(data.total, data.pos + data.size),
									total: data.total
								})}
							</span>
							{#if data.pos + data.size < data.total}
								<Button variant="outline" size="sm" href={pageHref(data.pos + data.size)}
									>{t('Next')}</Button
								>
							{/if}
						</div>
					</div>
				</form>
			</Card.Content>
		</Card.Root>

		{#if editing}
			<Card.Root data-testid="central-edit">
				<Card.Header><Card.Title>{t('Edit column {name}', { name: editing.original })}</Card.Title></Card.Header>
				<form
					method="POST"
					action="?/save"
					use:enhance={() =>
						async ({ update, result }) => {
							await update();
							if (result.type === 'success') editing = null;
						}}
				>
					<input
						type="hidden"
						name="definition"
						value={JSON.stringify({ original: editing.original, column: editing.columns[0] })}
					/>
					<Card.Content class="flex flex-col gap-4">
						<ColumnEditor
							bind:columns={editing.columns}
							caps={data.caps}
							collations={data.collations}
							showIndex={false}
							showAutoIncrement
							fixed
						/>
					</Card.Content>
					<Card.Footer class="gap-2">
						<Button type="submit" disabled={!hydration.ready}>{t('Save')}</Button>
						<Button type="button" variant="outline" onclick={() => (editing = null)}>{t('Cancel')}</Button>
					</Card.Footer>
				</form>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header><Card.Title>{t('Add a new central column')}</Card.Title></Card.Header>
			<form
				method="POST"
				action="?/save"
				use:enhance={() =>
					async ({ update, result }) => {
						await update();
						if (result.type === 'success') newCol = [newColumn()];
					}}
			>
				<input
					type="hidden"
					name="definition"
					value={JSON.stringify({ original: '', column: newCol[0] })}
				/>
				<Card.Content>
					<ColumnEditor
						bind:columns={newCol}
						caps={data.caps}
						collations={data.collations}
						showIndex={false}
						showAutoIncrement
						fixed
					/>
				</Card.Content>
				<Card.Footer>
					<Button type="submit" disabled={!hydration.ready} data-testid="central-add">
						{t('Add column')}
					</Button>
				</Card.Footer>
			</form>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Add columns from a table')}</Card.Title>
				<Card.Description>
					{t('Copy the definition of existing columns to the central list.')}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<form method="GET" action={base} class="flex items-center gap-2">
					<NativeSelect name="from" value={data.from} aria-label={t('Table')} class="max-w-xs">
						<NativeSelectOption value="">{t('Select a table')}</NativeSelectOption>
						{#each data.tables as tbl (tbl)}
							<NativeSelectOption value={tbl}>{tbl}</NativeSelectOption>
						{/each}
					</NativeSelect>
					<Button type="submit" variant="outline">{t('Show columns')}</Button>
				</form>
				{#if data.from}
					<form
						method="POST"
						action="?/addFromTable"
						use:enhance={() =>
							async ({ update }) => {
								await update();
								picked = [];
							}}
						class="flex flex-col gap-3"
						data-testid="central-from-table"
					>
						<input type="hidden" name="table" value={data.from} />
						{#each picked as name (name)}
							<input type="hidden" name="column" value={name} />
						{/each}
						{#each data.candidates as c (c.name)}
							<label class="flex items-center gap-2 text-sm">
								<Checkbox
									aria-label={t('Pick {name}', { name: c.name })}
									checked={picked.includes(c.name)}
									onCheckedChange={(v) => (picked = toggle(picked, c.name, v === true))}
								/>
								<span class="font-mono">{c.name}</span>
								<span class="font-mono text-muted-foreground">{c.type}</span>
							</label>
						{:else}
							<p class="text-sm text-muted-foreground">
								{t('Every column of this table is already in the central list.')}
							</p>
						{/each}
						{#if data.candidates.length}
							<div>
								<Button
									type="submit"
									disabled={!hydration.ready || picked.length === 0}
									data-testid="central-add-from-table"
								>
									{t('Add to central columns')}
								</Button>
							</div>
						{/if}
					</form>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
