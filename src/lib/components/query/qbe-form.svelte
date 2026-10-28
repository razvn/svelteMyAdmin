<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { untrack } from 'svelte';
	import NativeSelect from '#lib/components/table-search/native-select.svelte';
	import SqlEditor from '#lib/components/sql-editor/sql-editor.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import {
		applyEdits,
		buildQbeQuery,
		columnRef,
		emptyState,
		fromSearchData,
		schemaFromData,
		toSearchData,
		type QbeState
	} from '#lib/sql/qbe.ts';
	import type { QuerySchemaData } from '#lib/sql/query-schema.ts';

	interface Props {
		db: string;
		schema: QuerySchemaData;
		savedSearches: { id: number; name: string; data: Record<string, unknown> }[] | null;
		sqlHref: string;
	}
	let { db, schema, savedSearches, sqlHref }: Props = $props();

	const qbeSchema = $derived(schemaFromData(schema));
	let grid = $state<QbeState>(emptyState());
	let useTables = $state<string[]>(untrack(() => schema.tables.map((t) => t.name)));
	let sql = $state('');

	// Ins / Del checkboxes and the add counters, applied by "Update query"
	let colIns = $state<Record<number, boolean>>({});
	let colDel = $state<Record<number, boolean>>({});
	let rowIns = $state<Record<number, boolean>>({});
	let rowDel = $state<Record<number, boolean>>({});
	let addColumns = $state(0);
	let addRows = $state(0);

	let searchId = $state('');
	let searchName = $state('');
	const current = $derived(savedSearches?.find((s) => String(s.id) === searchId));

	const picked = (m: Record<number, boolean>) =>
		Object.entries(m)
			.filter(([, v]) => v)
			.map(([k]) => Number(k));

	const visibleTables = $derived(schema.tables.filter((t) => useTables.includes(t.name)));
	const sortOrders = $derived(Array.from({ length: grid.columns.length }, (_, i) => String(i + 1)));

	function update() {
		grid = applyEdits(grid, {
			insertColumns: picked(colIns),
			deleteColumns: picked(colDel),
			insertRows: picked(rowIns),
			deleteRows: picked(rowDel),
			addColumns,
			addRows
		});
		colIns = {};
		colDel = {};
		rowIns = {};
		rowDel = {};
		addColumns = 0;
		addRows = 0;
		sql = buildQbeQuery(grid, qbeSchema);
	}

	function onTablesChange() {
		// fields of tables that are no longer used cannot stay selected
		const keep = new Set(useTables.map((t) => columnRef(t, '*')));
		for (const c of grid.columns) {
			if (c.column === '') continue;
			const table = c.column.slice(0, c.column.lastIndexOf('.'));
			if (!keep.has(table + '.*')) c.column = '';
		}
	}

	function submit() {
		sql = buildQbeQuery(grid, qbeSchema);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- sqlHref is already resolved; only the query string is appended
		void goto(`${sqlHref}?sql_query=${encodeURIComponent(sql)}`);
	}

	function loadSearch() {
		const found = savedSearches?.find((s) => String(s.id) === searchId);
		if (!found) return;
		const loaded = fromSearchData(found.data);
		grid = loaded.state;
		if (loaded.tableList.length) useTables = loaded.tableList;
		searchName = found.name;
		sql = buildQbeQuery(grid, qbeSchema);
	}

	const searchData = $derived(JSON.stringify(toSearchData(grid, useTables)));
</script>

<div class="flex flex-col gap-6" data-testid="qbe">
	<Card.Root>
		<Card.Content class="flex flex-col gap-6">
			<div class="overflow-x-auto rounded-lg border">
				<Table.Root>
					<Table.Body>
						<Table.Row>
							<Table.Head scope="row">Field</Table.Head>
							{#each grid.columns as col, i (i)}
								<Table.Cell>
									<NativeSelect
										class="w-full min-w-40 font-mono"
										aria-label="Field {i + 1}"
										bind:value={col.column}
									>
										<option value=""></option>
										{#each visibleTables as t (t.name)}
											<optgroup label={t.name}>
												<option value={columnRef(t.name, '*')}>{t.name}.*</option>
												{#each t.columns as c (c)}
													<option value={columnRef(t.name, c)}>{t.name}.{c}</option>
												{/each}
											</optgroup>
										{/each}
									</NativeSelect>
								</Table.Cell>
							{/each}
						</Table.Row>
						<Table.Row>
							<Table.Head scope="row">Alias</Table.Head>
							{#each grid.columns as col, i (i)}
								<Table.Cell>
									<Input aria-label="Alias {i + 1}" bind:value={col.alias} />
								</Table.Cell>
							{/each}
						</Table.Row>
						<Table.Row>
							<Table.Head scope="row">Show</Table.Head>
							{#each grid.columns as col, i (i)}
								<Table.Cell>
									<input
										type="checkbox"
										class="size-4 accent-primary"
										aria-label="Show {i + 1}"
										bind:checked={col.show}
									/>
								</Table.Cell>
							{/each}
						</Table.Row>
						<Table.Row>
							<Table.Head scope="row">Sort</Table.Head>
							{#each grid.columns as col, i (i)}
								<Table.Cell>
									<NativeSelect
										class="w-full"
										aria-label="Sort {i + 1}"
										bind:value={col.sort}
										disabled={col.column.endsWith('.*')}
									>
										<option value=""></option>
										<option value="ASC">Ascending</option>
										<option value="DESC">Descending</option>
									</NativeSelect>
								</Table.Cell>
							{/each}
						</Table.Row>
						<Table.Row>
							<Table.Head scope="row">Sort order</Table.Head>
							{#each grid.columns as col, i (i)}
								<Table.Cell>
									<NativeSelect
										class="w-full"
										aria-label="Sort order {i + 1}"
										bind:value={col.sortOrder}
									>
										<option value=""></option>
										{#each sortOrders as n (n)}<option value={n}>{n}</option>{/each}
									</NativeSelect>
								</Table.Cell>
							{/each}
						</Table.Row>
						<Table.Row>
							<Table.Head scope="row">Criteria</Table.Head>
							{#each grid.columns as col, i (i)}
								<Table.Cell>
									<Input
										class="min-w-40 font-mono"
										aria-label="Criteria {i + 1}"
										bind:value={col.criteria}
									/>
								</Table.Cell>
							{/each}
						</Table.Row>
						<Table.Row>
							<Table.Head scope="row">Modify</Table.Head>
							{#each grid.columns as col, i (i)}
								<Table.Cell class="text-xs">
									<div class="flex flex-col gap-1">
										{#if i < grid.columns.length - 1}
											<span class="flex items-center gap-2">
												<label class="flex items-center gap-1">
													Or <input
														type="radio"
														name="andOrCol{i}"
														value="or"
														bind:group={col.andOr}
														aria-label="Or after column {i + 1}"
													/>
												</label>
												<label class="flex items-center gap-1">
													And <input
														type="radio"
														name="andOrCol{i}"
														value="and"
														bind:group={col.andOr}
														aria-label="And after column {i + 1}"
													/>
												</label>
											</span>
										{/if}
										<span class="flex items-center gap-2">
											<label class="flex items-center gap-1"
												>Ins <input
													type="checkbox"
													aria-label="Insert column before {i + 1}"
													bind:checked={colIns[i]}
												/></label
											>
											<label class="flex items-center gap-1"
												>Del <input
													type="checkbox"
													aria-label="Delete column {i + 1}"
													bind:checked={colDel[i]}
												/></label
											>
										</span>
									</div>
								</Table.Cell>
							{/each}
						</Table.Row>
						{#each grid.rows as row, r (r)}
							<Table.Row data-testid="qbe-row-{r}">
								<Table.Cell class="text-xs">
									<div class="flex flex-col gap-1">
										<span class="flex items-center gap-2">
											<label class="flex items-center gap-1">
												Or <input
													type="radio"
													name="andOrRow{r}"
													value="or"
													bind:group={row.andOr}
													aria-label="Or row {r + 1}"
												/>
											</label>
											<label class="flex items-center gap-1">
												And <input
													type="radio"
													name="andOrRow{r}"
													value="and"
													bind:group={row.andOr}
													aria-label="And row {r + 1}"
												/>
											</label>
										</span>
										<span class="flex items-center gap-2">
											<label class="flex items-center gap-1"
												>Ins <input
													type="checkbox"
													aria-label="Insert row before {r + 1}"
													bind:checked={rowIns[r]}
												/></label
											>
											<label class="flex items-center gap-1"
												>Del <input
													type="checkbox"
													aria-label="Delete row {r + 1}"
													bind:checked={rowDel[r]}
												/></label
											>
										</span>
									</div>
								</Table.Cell>
								{#each grid.columns, i (i)}
									<Table.Cell>
										<Input
											class="min-w-40 font-mono"
											aria-label="Criteria row {r + 1} column {i + 1}"
											bind:value={row.cells[i]}
										/>
									</Table.Cell>
								{/each}
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			<div class="flex flex-wrap items-end gap-6">
				<div class="flex flex-col gap-2">
					<Label for="qbe-add-rows">Add/Delete criteria rows</Label>
					<Input id="qbe-add-rows" type="number" class="w-24" bind:value={addRows} />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="qbe-add-columns">Add/Delete columns</Label>
					<Input id="qbe-add-columns" type="number" class="w-24" bind:value={addColumns} />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="qbe-tables">Use tables</Label>
					<NativeSelect
						id="qbe-tables"
						multiple
						class="h-28 min-w-48"
						bind:value={useTables}
						onchange={onTablesChange}
					>
						{#each schema.tables as t (t.name)}
							<option value={t.name}>{t.name}</option>
						{/each}
					</NativeSelect>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	{#if savedSearches !== null}
		<Card.Root data-testid="qbe-saved">
			<Card.Content class="flex flex-wrap items-end gap-4">
				<div class="flex flex-col gap-2">
					<Label for="qbe-search-id">Saved bookmarked search</Label>
					<NativeSelect id="qbe-search-id" bind:value={searchId} onchange={loadSearch}>
						<option value="">New bookmark</option>
						{#each savedSearches as s (s.id)}
							<option value={String(s.id)}>{s.name}</option>
						{/each}
					</NativeSelect>
				</div>
				<form
					method="POST"
					action="?/save"
					class="flex items-end gap-2"
					use:enhance={() =>
						async ({ result, update: apply }) => {
							if (result.type === 'success') toast.success('Search saved.');
							else if (result.type === 'failure')
								toast.error(String(result.data?.searchError ?? 'Could not save.'));
							await apply({ reset: false });
						}}
				>
					<input type="hidden" name="data" value={searchData} />
					<input type="hidden" name="id" value={searchId} />
					<div class="flex flex-col gap-2">
						<Label for="qbe-search-name">Name</Label>
						<Input
							id="qbe-search-name"
							name="name"
							placeholder="Bookmark name"
							bind:value={searchName}
						/>
					</div>
					<Button type="submit" variant="outline" disabled={!hydration.ready}>
						{current ? 'Update bookmark' : 'Create bookmark'}
					</Button>
				</form>
				{#if current}
					<form
						method="POST"
						action="?/delete"
						use:enhance={() =>
							async ({ result, update: apply }) => {
								if (result.type === 'success') {
									toast.success('Search deleted.');
									searchId = '';
								}
								await apply({ reset: false });
							}}
					>
						<input type="hidden" name="id" value={searchId} />
						<Button type="submit" variant="outline" class="text-destructive">
							Delete bookmark
						</Button>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header><Card.Title>SQL query on database {db}</Card.Title></Card.Header>
		<Card.Content class="flex flex-col gap-4">
			<div data-testid="qbe-sql">
				<SqlEditor
					value={sql}
					readonly
					lint={false}
					minLines={4}
					aria-label="Generated SQL"
					placeholder="Press Update query to generate the SQL"
				/>
			</div>
			<div class="flex gap-2">
				<Button type="button" variant="outline" onclick={update}>Update query</Button>
				<Button type="button" onclick={submit}>Submit query</Button>
			</div>
		</Card.Content>
	</Card.Root>
</div>
