<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { tick, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Search from '@lucide/svelte/icons/search';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { bare } from '#lib/nav/paths.ts';
	import { tabHref } from '#lib/nav/tabs.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Form state starts from the criteria of the request; the GET form keeps what the user typed.
	let searchString = $state(untrack(() => data.criteria.searchString));
	let searchType = $state(untrack(() => String(data.criteria.searchType)));
	let columnName = $state(untrack(() => data.criteria.columnName));
	let checked = $state<string[]>(untrack(() => [...data.criteria.checkedTables]));

	let deleteTarget = $state<{ table: string; sql: string } | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state(false);
	let deleteForm = $state<HTMLFormElement>();

	const searchAction = $derived(resolve(bare(tabHref('db', { db: data.db }, 'search'))));
	// Delete posts to the results URL (same criteria in the query string).
	const resultsAction = $derived(searchAction + page.url.search);
	const allChecked = $derived(data.tables.length > 0 && checked.length === data.tables.length);

	function toggleTable(name: string, on: boolean) {
		checked = on ? [...new Set([...checked, name])] : checked.filter((n) => n !== name);
	}

	function browseHref(table: string): string {
		return resolve(bare(tabHref('table', { db: data.db, table }, 'browse')));
	}

	// Results only exist for a submitted search, so the criteria are always the submitted ones.
	const results = $derived(data.results);
</script>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Search}
		title="Search"
		description="Search the words or values in the tables of database {data.db}."
	/>

	<Card.Root>
		<form method="GET" action={searchAction} class="flex flex-col gap-6" data-testid="search-form">
			<Card.Header>
				<Card.Title>Search in database</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-6">
				<div class="flex flex-col gap-2">
					<Label for="criteriaSearchString">Words or values to search for (wildcard: "%"):</Label>
					<Input
						id="criteriaSearchString"
						name="criteriaSearchString"
						type="text"
						autocomplete="off"
						class="max-w-xl"
						bind:value={searchString}
					/>
				</div>

				<fieldset class="flex flex-col gap-3">
					<legend class="mb-1 text-sm font-medium">Find:</legend>
					<RadioGroup.Root name="criteriaSearchType" bind:value={searchType} class="gap-2">
						{#each data.searchTypes as type (type.value)}
							<div class="flex items-center gap-2">
								<RadioGroup.Item
									value={String(type.value)}
									id="criteriaSearchTypeRadio{type.value}"
								/>
								<Label for="criteriaSearchTypeRadio{type.value}" class="font-normal">
									{type.label}
									{#if type.value === 1 || type.value === 2}
										<span class="text-muted-foreground">(words are separated by a space)</span>
									{/if}
								</Label>
							</div>
						{/each}
					</RadioGroup.Root>
				</fieldset>

				<fieldset class="flex flex-col gap-3">
					<legend class="mb-1 flex w-full items-center justify-between text-sm font-medium">
						<span>Inside tables:</span>
						<span class="flex items-center gap-2 font-normal">
							<Button
								variant="link"
								size="sm"
								class="h-auto p-0"
								type="button"
								disabled={allChecked}
								onclick={() => (checked = data.tables.map((t) => t.name))}
							>
								Select all
							</Button>
							/
							<Button
								variant="link"
								size="sm"
								class="h-auto p-0"
								type="button"
								disabled={checked.length === 0}
								onclick={() => (checked = [])}
							>
								Unselect all
							</Button>
						</span>
					</legend>
					<div class="grid max-h-64 gap-2 overflow-auto rounded-lg border p-3 sm:grid-cols-2">
						{#each data.tables as table (table.name)}
							<div class="flex items-center gap-2">
								<Checkbox
									id="criteriaTables-{table.name}"
									name="criteriaTables"
									value={table.name}
									checked={checked.includes(table.name)}
									onCheckedChange={(v) => toggleTable(table.name, v === true)}
								/>
								<Label for="criteriaTables-{table.name}" class="font-mono font-normal">
									{table.name}
								</Label>
								{#if table.isView}
									<Badge variant="muted">view</Badge>
								{/if}
							</div>
						{:else}
							<p class="text-sm text-muted-foreground sm:col-span-2">No tables in this database.</p>
						{/each}
					</div>
				</fieldset>

				<div class="flex flex-col gap-2">
					<Label for="criteriaColumnName">Inside column:</Label>
					<Input
						id="criteriaColumnName"
						name="criteriaColumnName"
						type="text"
						autocomplete="off"
						class="max-w-xl"
						bind:value={columnName}
					/>
				</div>
			</Card.Content>
			<Card.Footer class="border-t">
				<Button type="submit" name="submit_search" value="Go">Go</Button>
			</Card.Footer>
		</form>
	</Card.Root>

	{#if form?.deleteError}
		<Alert variant="destructive" role="alert">
			<AlertDescription>{form.deleteError}</AlertDescription>
		</Alert>
	{/if}

	{#if results}
		<Card.Root class="gap-0 py-0" data-testid="search-results">
			<Card.Header class="border-b py-5">
				<Card.Title>
					Search results for "<em>{data.criteria.searchString}</em>" {data.searchTypeLabel}:
				</Card.Title>
			</Card.Header>
			<Card.Content class="px-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Matches</Table.Head>
							<Table.Head class="text-end">Browse</Table.Head>
							<Table.Head class="text-end">Delete</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each results.rows as row (row.table)}
							<Table.Row
								class={row.count === 0 ? 'text-muted-foreground' : ''}
								data-testid="search-row-{row.table}"
							>
								<Table.Cell class="whitespace-normal">
									{row.count}
									{row.count === 1 ? 'match' : 'matches'} in
									<strong class="font-mono">{row.table}</strong>
								</Table.Cell>
								<Table.Cell class="text-end">
									{#if row.count > 0}
										<Button variant="outline" size="sm" href={browseHref(row.table)}>Browse</Button>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-end">
									{#if row.count > 0 && !row.isView && row.deleteSql}
										<Button
											variant="outline"
											size="sm"
											class="text-destructive"
											onclick={() => {
												deleteTarget = { table: row.table, sql: row.deleteSql ?? '' };
												deleteOpen = true;
											}}
										>
											<Trash2 /> Delete
										</Button>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
					<Table.Footer>
						<Table.Row>
							<Table.Cell class="font-semibold">
								Total: <span data-testid="search-total">{results.total}</span>
								{results.total === 1 ? 'match' : 'matches'}
							</Table.Cell>
							<Table.Cell></Table.Cell>
							<Table.Cell></Table.Cell>
						</Table.Row>
					</Table.Footer>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<form
			bind:this={deleteForm}
			method="POST"
			action={resultsAction}
			class="hidden"
			use:enhance={() => {
				deleting = true;
				return async ({ result, update }) => {
					if (result.type === 'success') {
						toast.success(
							`${result.data?.deleted ?? 0} rows deleted from ${result.data?.deleteTable ?? ''}.`
						);
					} else if (result.type === 'failure') {
						toast.error(String(result.data?.deleteError ?? 'Could not delete the rows.'));
					}
					await update({ reset: false });
					deleting = false;
					deleteOpen = false;
				};
			}}
		>
			<input type="hidden" name="table" value={deleteTarget?.table ?? ''} />
		</form>
	{/if}
</div>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete matching rows?</AlertDialog.Title>
			<AlertDialog.Description>
				This runs the following SQL against table
				<strong class="font-mono">{deleteTarget?.table}</strong>. It cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<pre
			class="max-h-48 overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
			data-testid="delete-sql">{deleteTarget?.sql}</pre>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				disabled={deleting}
				onclick={async (e: MouseEvent) => {
					e.preventDefault();
					// the hidden `table` input follows deleteTarget on the next tick
					await tick();
					deleteForm?.requestSubmit();
				}}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
