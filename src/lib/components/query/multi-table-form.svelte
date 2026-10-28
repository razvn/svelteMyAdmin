<script lang="ts">
	import { goto } from '$app/navigation';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import NativeSelect from '#lib/components/table-search/native-select.svelte';
	import SqlEditor from '#lib/components/sql-editor/sql-editor.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import {
		MTQ_HINTS,
		MTQ_OPERATORS,
		buildMultiTableQuery,
		emptyMtqColumn,
		foreignKeysFromSchema,
		isOpWithoutArg,
		type MtqColumn
	} from '#lib/sql/multi-table-query.ts';
	import type { QuerySchemaData } from '#lib/sql/query-schema.ts';

	interface Props {
		db: string;
		schema: QuerySchemaData;
		sqlHref: string;
	}
	let { db, schema, sqlHref }: Props = $props();

	const foreignKeys = $derived(foreignKeysFromSchema(schema));
	let cards = $state<MtqColumn[]>(Array.from({ length: 3 }, emptyMtqColumn));
	let sql = $state('');
	let error = $state('');

	const columnsOf = (table: string) => schema.tables.find((t) => t.name === table)?.columns ?? [];

	function onTableChange(c: MtqColumn) {
		c.column = '';
		c.criteriaColumn = '';
		if (c.columnAlias !== '') c.columnAlias = '';
	}

	function onColumnChange(c: MtqColumn) {
		if (c.column === '*') c.columnAlias = '';
		if (c.criteriaColumn === '' && c.column !== '*') c.criteriaColumn = c.column;
	}

	function update(): boolean {
		const res = buildMultiTableQuery(cards, foreignKeys);
		if (res.ok) {
			sql = res.sql;
			error = '';
		} else {
			error = res.error;
		}
		return res.ok;
	}

	function submit() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- sqlHref is already resolved; only the query string is appended
		if (update()) void goto(`${sqlHref}?sql_query=${encodeURIComponent(sql)}`);
	}
</script>

<div class="flex flex-col gap-6" data-testid="mtq">
	<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
		{#each cards as c, i (i)}
			<Card.Root data-testid="mtq-card-{i}" class="relative">
				<Card.Content class="flex flex-col gap-3">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						class="absolute end-2 top-2"
						aria-label="Remove column {i + 1}"
						onclick={() => cards.splice(i, 1)}
					>
						<X />
					</Button>
					<div class="flex items-center gap-2 pe-8">
						<NativeSelect
							class="min-w-0 flex-1"
							aria-label="Table {i + 1}"
							bind:value={c.table}
							onchange={() => onTableChange(c)}
						>
							<option value="">select table</option>
							{#each schema.tables as t (t.name)}<option value={t.name}>{t.name}</option>{/each}
						</NativeSelect>
						<span>.</span>
						<NativeSelect
							class="min-w-0 flex-1"
							aria-label="Column {i + 1}"
							bind:value={c.column}
							onchange={() => onColumnChange(c)}
							disabled={c.table === ''}
						>
							<option value="">select column</option>
							{#if c.table !== ''}<option value="*">*</option>{/if}
							{#each columnsOf(c.table) as col (col)}<option value={col}>{col}</option>{/each}
						</NativeSelect>
					</div>
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" class="size-4 accent-primary" bind:checked={c.show} /> Show
					</label>
					<div class="grid grid-cols-2 gap-2">
						<Input
							placeholder="Table alias"
							aria-label="Table alias {i + 1}"
							bind:value={c.tableAlias}
						/>
						<Input
							placeholder="Column alias"
							aria-label="Column alias {i + 1}"
							bind:value={c.columnAlias}
							disabled={c.column === '*'}
						/>
					</div>
					<div class="flex items-center gap-2">
						<Label class="text-sm">Sort</Label>
						<NativeSelect aria-label="Sort {i + 1}" bind:value={c.sort}>
							<option value=""></option>
							<option value="ASC">Ascending</option>
							<option value="DESC">Descending</option>
						</NativeSelect>
					</div>
					<label class="flex items-center gap-2 text-sm font-medium">
						<input
							type="checkbox"
							class="size-4 accent-primary"
							aria-label="Use column {i + 1} in criteria"
							bind:checked={c.useCriteria}
						/>
						Criteria
					</label>
					{#if c.useCriteria}
						<div class="flex flex-col gap-2 rounded-lg border p-3">
							<div class="flex items-center gap-2 text-sm">
								Add as
								<label class="flex items-center gap-1">
									<input type="radio" bind:group={c.logicalOp} value="AND" name="op{i}" /> AND
								</label>
								<label class="flex items-center gap-1">
									<input type="radio" bind:group={c.logicalOp} value="OR" name="op{i}" /> OR
								</label>
							</div>
							<NativeSelect
								aria-label="Criteria column {i + 1}"
								bind:value={c.criteriaColumn}
								disabled={c.table === ''}
							>
								<option value="">select column</option>
								{#each columnsOf(c.table) as col (col)}<option value={col}>{col}</option>{/each}
							</NativeSelect>
							<div class="grid grid-cols-2 gap-2">
								<NativeSelect aria-label="Operator {i + 1}" bind:value={c.op}>
									{#each MTQ_OPERATORS as op (op)}<option value={op}>{op}</option>{/each}
								</NativeSelect>
								<NativeSelect aria-label="Right side {i + 1}" bind:value={c.rhs}>
									<option value="text">Text</option>
									<option value="anotherColumn">Another column</option>
								</NativeSelect>
							</div>
							{#if isOpWithoutArg(c.op)}
								<!-- no argument -->
							{:else if c.rhs === 'text'}
								<Input
									placeholder="Enter criteria as free text"
									aria-label="Criteria value {i + 1}"
									bind:value={c.rhsText}
								/>
								{#if MTQ_HINTS[c.op]}
									<p class="text-xs text-muted-foreground">{MTQ_HINTS[c.op]}</p>
								{/if}
							{:else}
								<div class="grid grid-cols-2 gap-2">
									<NativeSelect
										aria-label="Other table {i + 1}"
										bind:value={c.rhsTable}
										onchange={() => (c.rhsColumn = '')}
									>
										<option value="">select table</option>
										{#each schema.tables as t (t.name)}<option value={t.name}>{t.name}</option
											>{/each}
									</NativeSelect>
									<NativeSelect aria-label="Other column {i + 1}" bind:value={c.rhsColumn}>
										<option value="">select column</option>
										{#each columnsOf(c.rhsTable) as col (col)}<option value={col}>{col}</option
											>{/each}
									</NativeSelect>
								</div>
							{/if}
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
		{/each}
		<button
			type="button"
			class="flex min-h-24 items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground hover:bg-muted"
			onclick={() => cards.push(emptyMtqColumn())}
		>
			<Plus class="size-4" /> Add column
		</button>
	</div>

	{#if error}
		<Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>
	{/if}

	<Card.Root>
		<Card.Header><Card.Title>SQL query on database {db}</Card.Title></Card.Header>
		<Card.Content class="flex flex-col gap-4">
			<div data-testid="mtq-sql">
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
