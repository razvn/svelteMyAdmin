<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- hrefs are built by href()/sortHref() on top of page.url.pathname plus a query string */
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Database from '@lucide/svelte/icons/database';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { formatByteDown, formatNumber } from '#lib/format.ts';
	import type { StatColumn } from '#lib/server/admin/databases.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const STAT_HEADERS: { key: StatColumn; title: string; bytes: boolean }[] = [
		{ key: 'SCHEMA_TABLES', title: 'Tables', bytes: false },
		{ key: 'SCHEMA_TABLE_ROWS', title: 'Rows', bytes: false },
		{ key: 'SCHEMA_DATA_LENGTH', title: 'Data', bytes: true },
		{ key: 'SCHEMA_INDEX_LENGTH', title: 'Indexes', bytes: true },
		{ key: 'SCHEMA_LENGTH', title: 'Total', bytes: true },
		{ key: 'SCHEMA_DATA_FREE', title: 'Overhead', bytes: true }
	];

	let collation = $derived(data.defaultCollation);
	let filter = $state('');
	let selected = $state<string[]>([]);
	let confirmOpen = $state(false);
	let creating = $state(false);
	let dropping = $state(false);
	let dropForm = $state<HTMLFormElement>();

	const byCharset = $derived(
		Object.entries(Object.groupBy(data.collations, (c) => c.charset)).map(([charset, list]) => ({
			charset,
			list: list ?? []
		}))
	);
	const visible = $derived(
		data.databases.filter((d) => d.name.toLowerCase().includes(filter.trim().toLowerCase()))
	);
	const selectable = $derived(
		visible.filter((d) => !d.isSystemSchema && !d.isPmadb).map((d) => d.name)
	);
	const allChecked = $derived(
		selectable.length > 0 && selectable.every((n) => selected.includes(n))
	);
	const droppable = $derived(selected.filter((n) => data.databases.some((d) => d.name === n)));

	function href(params: Record<string, string | number | boolean | null>): string {
		const u = new SvelteURLSearchParams();
		const merged: Record<string, string | number | boolean | null> = {
			statistics: data.statistics ? 1 : null,
			pos: data.pos || null,
			sort_by: data.sortBy === 'SCHEMA_NAME' ? null : data.sortBy,
			sort_order: data.sortOrder === 'asc' ? null : data.sortOrder,
			...params
		};
		for (const [k, v] of Object.entries(merged)) if (v !== null) u.set(k, String(v));
		const qs = u.toString();
		return qs ? `${page.url.pathname}?${qs}` : page.url.pathname;
	}

	function sortHref(col: string): string {
		const order = data.sortBy === col && data.sortOrder === 'asc' ? 'desc' : 'asc';
		return href({ sort_by: col, sort_order: order, pos: null });
	}

	function toggleAll(checked: boolean) {
		selected = checked
			? [...new Set([...selected, ...selectable])]
			: selected.filter((n) => !selectable.includes(n));
	}

	function toggle(name: string, checked: boolean) {
		selected = checked ? [...selected, name] : selected.filter((n) => n !== name);
	}

	const lastPos = $derived(Math.max(0, data.total - 1));
	const prevPos = $derived(Math.max(0, data.pos - data.maxDbList));
	const nextPos = $derived(data.pos + data.maxDbList);
</script>

{#snippet sortMark(col: string)}
	{#if data.sortBy === col}
		{#if data.sortOrder === 'asc'}
			<ArrowUp class="size-3.5" aria-label="Ascending" />
		{:else}
			<ArrowDown class="size-3.5" aria-label="Descending" />
		{/if}
	{/if}
{/snippet}

{#snippet sortHeader(col: string, title: string)}
	<a href={sortHref(col)} class="inline-flex items-center gap-1 hover:underline">
		{title}
		{@render sortMark(col)}
	</a>
{/snippet}

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Database}
		title={data.statistics ? 'Databases statistics' : 'Databases'}
		description="{data.total} {data.total === 1 ? 'database' : 'databases'} on this server."
	>
		{#snippet actions()}
			{#if data.statistics}
				<Button variant="outline" href={href({ statistics: null })}>Hide statistics</Button>
			{:else if data.total > 0}
				<Button variant="outline" href={href({ statistics: 1 })}>Show statistics</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.showCreate}
		<Card.Root>
			<Card.Header>
				<Card.Title>Create database</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if data.canCreate}
					<form
						method="POST"
						action="?/create"
						class="flex flex-wrap items-center gap-2"
						use:enhance={() => {
							creating = true;
							return async ({ result, update }) => {
								if (result.type === 'success') {
									toast.success(`Database ${result.data?.created} has been created.`);
								}
								await update();
								creating = false;
							};
						}}
					>
						<Input
							name="new_db"
							maxlength={64}
							required
							autocomplete="off"
							placeholder="Database name"
							aria-label="Database name"
							class="w-64"
						/>
						<Select.Root type="single" name="db_collation" bind:value={collation}>
							<Select.Trigger class="w-64" aria-label="Collation" data-testid="create-collation">
								{collation || 'Collation'}
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
						<Button type="submit" disabled={creating}>Create</Button>
					</form>
					{#if form?.createError}
						<p class="mt-2 text-sm text-destructive" role="alert">{form.createError}</p>
					{/if}
				{:else}
					<p class="text-sm text-destructive">No privileges to create databases</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if form?.dropError}
		<Alert variant="destructive" role="alert">
			<AlertDescription>{form.dropError}</AlertDescription>
		</Alert>
	{/if}
	{#if form?.skipped?.length}
		<Alert role="status">
			<AlertDescription>
				System databases cannot be dropped: {form.skipped.join(', ')}
			</AlertDescription>
		</Alert>
	{/if}

	{#if data.total > 0}
		<Card.Root class="gap-0 py-0">
			<div class="flex flex-wrap items-center gap-2 border-b p-5">
				{#if data.dropAllowed}
					<div class="flex items-center gap-2">
						<Checkbox
							id="check-all"
							checked={allChecked}
							onCheckedChange={(v) => toggleAll(v === true)}
							aria-label="Check all"
						/>
						<label for="check-all" class="text-sm">Check all</label>
						<Button
							variant="outline"
							size="sm"
							disabled={droppable.length === 0}
							onclick={() => (confirmOpen = true)}
							data-testid="bulk-drop"
						>
							<Trash2 /> Drop
						</Button>
					</div>
				{/if}
				<Input
					bind:value={filter}
					type="search"
					placeholder="Search"
					aria-label="Search"
					class="ml-auto w-56"
				/>
			</div>

			{#if data.total > data.maxDbList}
				<nav class="flex items-center gap-2 border-b px-5 py-3 text-sm" aria-label="Pagination">
					<Button variant="outline" size="sm" href={href({ pos: 0 })} disabled={data.pos === 0}>
						Start
					</Button>
					<Button
						variant="outline"
						size="sm"
						href={href({ pos: prevPos || null })}
						disabled={data.pos === 0}
					>
						Previous
					</Button>
					<span class="text-muted-foreground">
						Showing {data.pos + 1} - {Math.min(data.total, data.pos + data.maxDbList)} of {data.total}
					</span>
					<Button
						variant="outline"
						size="sm"
						href={href({ pos: nextPos })}
						disabled={nextPos > lastPos}
					>
						Next
					</Button>
				</nav>
			{/if}

			<form
				bind:this={dropForm}
				id="dbStatsForm"
				method="POST"
				action="?/drop"
				use:enhance={() => {
					dropping = true;
					return async ({ result, update }) => {
						if (result.type === 'success') {
							const n = (result.data?.dropped as string[] | undefined)?.length ?? 0;
							toast.success(
								n === 1
									? '1 database has been dropped successfully.'
									: `${n} databases have been dropped successfully.`
							);
							selected = [];
						} else if (result.type === 'failure') {
							toast.error(String(result.data?.dropError ?? 'Could not drop the databases.'));
						}
						await update({ reset: false });
						dropping = false;
						confirmOpen = false;
					};
				}}
			>
				{#each droppable as name (name)}
					<input type="hidden" name="selected_dbs" value={name} />
				{/each}
				<Table.Root data-testid="databases-table">
					<Table.Header>
						<Table.Row>
							{#if data.dropAllowed}<Table.Head class="w-8"></Table.Head>{/if}
							<Table.Head>{@render sortHeader('SCHEMA_NAME', 'Database')}</Table.Head>
							<Table.Head>{@render sortHeader('DEFAULT_COLLATION_NAME', 'Collation')}</Table.Head>
							{#if data.statistics}
								{#each STAT_HEADERS as h (h.key)}
									<Table.Head colspan={h.bytes ? 2 : 1} class={h.bytes ? 'text-center' : 'text-end'}
										>{@render sortHeader(h.key, h.title)}</Table.Head
									>
								{/each}
							{/if}
							<Table.Head class="text-end">Action</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each visible as db (db.name)}
							<Table.Row data-testid="db-row-{db.name}">
								{#if data.dropAllowed}
									<Table.Cell>
										<Checkbox
											checked={selected.includes(db.name)}
											onCheckedChange={(v) => toggle(db.name, v === true)}
											disabled={db.isSystemSchema || db.isPmadb}
											aria-label="Select {db.name}"
										/>
									</Table.Cell>
								{/if}
								<Table.Cell>
									<a
										href="/db/{encodeURIComponent(db.name)}/structure"
										class="font-medium text-foreground hover:text-primary hover:underline"
										title="Jump to database '{db.name}'"
									>
										{db.name}
									</a>
								</Table.Cell>
								<Table.Cell><Badge variant="muted">{db.collation}</Badge></Table.Cell>
								{#if data.statistics && db.stats}
									{#each STAT_HEADERS as h (h.key)}
										{#if h.bytes}
											{@const v = formatByteDown(db.stats[h.key], 3, 1)}
											<Table.Cell
												class="pe-1 text-right tabular-nums"
												title={String(db.stats[h.key])}
											>
												{v?.[0]}
											</Table.Cell>
											<Table.Cell class="ps-0 text-muted-foreground">{v?.[1]}</Table.Cell>
										{:else}
											<Table.Cell class="text-right tabular-nums" title={String(db.stats[h.key])}>
												{formatNumber(db.stats[h.key])}
											</Table.Cell>
										{/if}
									{/each}
								{/if}
								<Table.Cell class="text-end">
									<a
										href="/server/privileges?db={encodeURIComponent(
											db.name
										)}&checkprivsdb={encodeURIComponent(db.name)}"
										class="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
										title="Check privileges for database &quot;{db.name}&quot;."
									>
										<ShieldCheck class="size-4" /> Check privileges
									</a>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
					<Table.Footer>
						<Table.Row>
							<Table.Cell colspan={data.dropAllowed ? 3 : 2} class="font-semibold">
								Total: <span data-testid="db-total">{data.total}</span>
							</Table.Cell>
							{#if data.statistics && data.totals}
								{#each STAT_HEADERS as h (h.key)}
									{#if h.bytes}
										{@const v = formatByteDown(data.totals[h.key], 3, 1)}
										<Table.Cell class="pe-1 text-right font-semibold tabular-nums"
											>{v?.[0]}</Table.Cell
										>
										<Table.Cell class="ps-0 text-muted-foreground">{v?.[1]}</Table.Cell>
									{:else}
										<Table.Cell class="text-right font-semibold tabular-nums">
											{formatNumber(data.totals[h.key])}
										</Table.Cell>
									{/if}
								{/each}
							{/if}
							<Table.Cell></Table.Cell>
						</Table.Row>
					</Table.Footer>
				</Table.Root>
			</form>
		</Card.Root>

		{#if !data.statistics}
			<Alert>
				<AlertDescription>
					Note: Enabling the database statistics here might cause heavy traffic between the web
					server and the MySQL server.
					<a href={href({ statistics: 1 })} class="font-medium underline">Enable statistics</a>
				</AlertDescription>
			</Alert>
		{/if}
	{:else}
		<Alert><AlertDescription>No databases</AlertDescription></Alert>
	{/if}
</div>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Confirm</AlertDialog.Title>
			<AlertDialog.Description>
				You are about to DESTROY a complete database! This cannot be undone. Databases to drop:
			</AlertDialog.Description>
		</AlertDialog.Header>
		<ul class="max-h-48 list-disc overflow-auto pl-6 text-sm" data-testid="drop-list">
			{#each droppable as name (name)}
				<li class="font-mono">{name}</li>
			{/each}
		</ul>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				disabled={dropping}
				onclick={(e: MouseEvent) => {
					e.preventDefault();
					dropForm?.requestSubmit();
				}}
			>
				Drop
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
