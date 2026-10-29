<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Layers from '@lucide/svelte/icons/layers';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import ColumnEditor from '#lib/components/columns/column-editor.svelte';
	import NativeSelect from '#lib/components/table-search/native-select.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { N_, useI18n } from '#lib/i18n/index.ts';
	import { bare } from '#lib/nav/paths.ts';
	import { tabHref } from '#lib/nav/tabs.ts';
	import { buildAddColumns } from '#lib/sql/alter-table.ts';
	import { newColumn, type ColumnDef } from '#lib/sql/column-definition.ts';
	import { buildAddKey } from '#lib/sql/index-definition.ts';
	import { buildDropColumns } from '#lib/sql/alter-table.ts';
	import {
		checkNames,
		groupDependencies,
		keyName,
		planDecomposition,
		planRepeatingGroup,
		type NormalForm
	} from '#lib/sql/normalization.ts';
	import type { NormalizationTable } from '#lib/server/table/normalization.ts';
	import type { PageProps } from './$types';

	const i18n = useI18n();
	const { t } = i18n;
	let { data }: PageProps = $props();

	type Step = '1.1' | '1.2' | '1.3' | '1.4' | '2.1' | '2.2' | '3.1' | '3.2' | 'done';

	const info = $derived<NormalizationTable>(data.info);
	const db = $derived(data.db);
	const table = $derived(data.table);

	let target = $state<NormalForm>('1nf');
	let started = $state(false);
	let step = $state<Step>('1.1');
	let busy = $state(false);
	let error = $state('');
	let log = $state<{ step: string; sql: string[] }[]>([]);

	// step inputs
	let pkChoice = $state<string[]>([]);
	let pkMode = $state<'existing' | 'new'>('existing');
	/* svelte-ignore state_referenced_locally */
	let pkColumn = $state<ColumnDef[]>([
		newColumn({ name: `${data.table}_id`, type: 'INT', autoIncrement: true, index: 'PRIMARY' })
	]);
	let redundant = $state<string[]>([]);
	let splitColumn = $state('');
	let splitCount = $state('2');
	let splitCols = $state<ColumnDef[]>([]);
	let repeating = $state<string[]>([]);
	let repeatTable = $state('');
	let repeatColumn = $state('');
	// 2NF / 3NF: per table, per non-key column, the chosen determinants
	let tablesFor3nf = $state<string[]>([]);
	let infos = $state<Record<string, NormalizationTable>>({});
	let answers = $state<Record<string, Record<string, string[]>>>({});
	let names = $state<Record<string, Record<string, string>>>({});
	let found = $state<Record<string, string[]> | null>(null);

	const structureHref = $derived(resolve(bare(tabHref('table', { db, table }, 'structure'))));
	const nonPk = (tbl: NormalizationTable) =>
		tbl.columns.map((c) => c.name).filter((c) => !tbl.pk.includes(c));
	const stringColumns = $derived(info.columns.filter((c) => c.isString));
	const toggle = (list: string[], v: string, on: boolean): string[] =>
		on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v);

	interface ApiResult {
		ok?: boolean;
		error?: string;
		sql: string[];
		tables?: string[];
		dependencies: Record<string, string[]>;
		info: NormalizationTable;
	}

	async function api(body: unknown): Promise<ApiResult> {
		const res = await fetch(`${page.url.pathname.replace(/\/$/, '')}/run`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) throw new Error(t('The request failed.'));
		return (await res.json()) as ApiResult;
	}

	/** Run one operation; on success refresh the table metadata and return true. */
	async function execute(label: string, op: unknown): Promise<{ ok: boolean; tables?: string[] }> {
		busy = true;
		error = '';
		try {
			const res = await api({ kind: 'op', op });
			if (!res.ok) {
				error = res.error ? t(res.error) : t('The statement failed.');
				return { ok: false };
			}
			log.push({ step: label, sql: res.sql });
			await invalidateAll();
			return { ok: true, tables: res.tables };
		} catch (e) {
			error = e instanceof Error ? e.message : t('The request failed.');
			return { ok: false };
		} finally {
			busy = false;
		}
	}

	function afterOneNf(): Step {
		if (target === '1nf') return 'done';
		start2nf();
		return '2.1';
	}

	// --- step 1.1: primary key ---
	const pkSql = $derived(
		pkMode === 'existing'
			? pkChoice.length
				? buildAddKey(db, table, 'PRIMARY', pkChoice)
				: ''
			: buildAddColumns(db, table, pkColumn, data.caps, { where: 'first' })
	);
	async function savePk() {
		const r =
			pkMode === 'existing'
				? await execute('1.1', { op: 'addPrimary', columns: pkChoice })
				: await execute('1.1', {
						op: 'addColumns',
						payload: { columns: $state.snapshot(pkColumn), placement: { where: 'first' } }
					});
		if (r.ok) step = '1.2';
	}

	// --- step 1.2: remove redundant columns ---
	const dropSql = $derived(redundant.length ? buildDropColumns(db, table, redundant) : '');
	async function dropRedundant() {
		const r = await execute('1.2', { op: 'dropColumns', columns: redundant });
		if (r.ok) {
			redundant = [];
			step = '1.3';
		}
	}

	// --- step 1.3: split a column ---
	function prepareSplit() {
		const n = Math.min(Math.max(Number.parseInt(splitCount, 10) || 2, 2), 16);
		splitCols = Array.from({ length: n }, (_, i) =>
			newColumn({ name: `${splitColumn}_${i + 1}`, type: 'VARCHAR', length: '255', null: true })
		);
	}
	const splitSql = $derived(
		splitColumn && splitCols.length
			? buildAddColumns(db, table, splitCols, data.caps, { where: 'after', after: splitColumn })
			: ''
	);
	async function saveSplit() {
		const r = await execute('1.3', {
			op: 'addColumns',
			payload: {
				columns: $state.snapshot(splitCols),
				placement: { where: 'after', after: splitColumn }
			}
		});
		if (r.ok) {
			splitCols = [];
			splitColumn = '';
			step = '1.4';
		}
	}

	// --- step 1.4: repeating group ---
	const repeatSql = $derived(
		repeating.length >= 2 && repeatTable && repeatColumn && info.pk.length
			? planRepeatingGroup(db, table, info.pk, repeating, repeatTable, repeatColumn).join('\n')
			: ''
	);
	async function moveRepeating() {
		const r = await execute('1.4', {
			op: 'repeating',
			columns: repeating,
			newTable: repeatTable,
			newColumn: repeatColumn
		});
		if (r.ok) {
			repeating = [];
			step = afterOneNf();
		}
	}

	// --- 2NF ---
	function start2nf() {
		answers[table] = {};
		names[table] = {};
		found = null;
	}
	async function showPossible() {
		busy = true;
		error = '';
		try {
			found = (await api({ kind: 'pd' })).dependencies;
		} catch (e) {
			error = e instanceof Error ? e.message : t('The request failed.');
		} finally {
			busy = false;
		}
	}
	function pick(determinants: string, dependents: string[]) {
		const a = { ...(answers[table] ?? {}) };
		for (const d of dependents) a[d] = determinants.split(', ');
		answers[table] = a;
	}

	/** The decomposition the answers for `tbl` describe. */
	function groupsFor(tbl: NormalizationTable) {
		const a = answers[tbl.table] ?? {};
		const list = nonPk(tbl).map((column) => ({ column, dependsOn: a[column] ?? [] }));
		return groupDependencies(tbl.table, tbl.pk, list, names[tbl.table] ?? {});
	}
	const plan = $derived.by(() => {
		const tables = step === '2.2' ? [info] : tablesFor3nf.map((n) => infos[n]).filter(Boolean);
		return tables.map((tbl) => {
			const groups = groupsFor(tbl);
			return {
				info: tbl,
				groups,
				error: checkNames(tbl.table, groups, data.tables, i18n),
				sql:
					groups.length > 1
						? planDecomposition(
								db,
								tbl.table,
								tbl.columns.map((c) => c.name),
								groups
							)
						: []
			};
		});
	});

	function next2nf() {
		if (info.pk.length < 2) {
			skipTo3nf([table]);
			return;
		}
		step = '2.2';
	}
	function skipTo3nf(tables: string[]) {
		if (target === '3nf') void start3nf(tables);
		else step = 'done';
	}
	async function applyPlan(label: string, nextStep: () => void) {
		const created: string[] = [];
		for (const p of plan) {
			if (p.error) {
				error = p.error;
				return;
			}
			if (p.groups.length < 2) {
				created.push(p.info.table);
				continue;
			}
			const r = await execute(label, {
				op: 'decompose',
				table: p.info.table,
				answers: nonPk(p.info).map((column) => ({
					column,
					dependsOn: answers[p.info.table]?.[column] ?? []
				})),
				names: names[p.info.table] ?? {}
			});
			if (!r.ok) return;
			created.push(...(r.tables ?? []));
		}
		tablesFor3nf = created;
		nextStep();
	}

	// --- 3NF ---
	async function start3nf(tables: string[]) {
		busy = true;
		error = '';
		try {
			const loaded: Record<string, NormalizationTable> = {};
			for (const n of tables) loaded[n] = (await api({ kind: 'info', table: n })).info;
			infos = loaded;
			tablesFor3nf = tables.filter((n) => loaded[n].pk.length > 0 && nonPk(loaded[n]).length > 1);
			for (const n of tablesFor3nf) {
				answers[n] = {};
				names[n] = {};
			}
			step = '3.1';
		} catch (e) {
			error = e instanceof Error ? e.message : t('The request failed.');
		} finally {
			busy = false;
		}
	}

	function begin() {
		started = true;
		step = '1.1';
		error = '';
		log = [];
		if (info.pk.length) step = '1.2';
	}
</script>

<svelte:head><title>{t('Normalization')} - {table}</title></svelte:head>

{#snippet sqlBox(sql: string)}
	{#if sql}
		<pre
			class="max-h-64 overflow-auto rounded-lg border bg-muted p-3 font-mono text-sm whitespace-pre-wrap"
			data-testid="norm-sql">{sql}</pre>
	{/if}
{/snippet}

{#snippet colChecks(cols: string[], chosen: string[], onchange: (v: string, on: boolean) => void)}
	<div class="flex flex-wrap gap-x-5 gap-y-2">
		{#each cols as c (c)}
			<div class="flex items-center gap-2">
				<Checkbox
					id="chk-{c}"
					aria-label={c}
					checked={chosen.includes(c)}
					onCheckedChange={(v) => onchange(c, v === true)}
				/>
				<Label for="chk-{c}" class="font-normal">{c}</Label>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet depForm(tbl: NormalizationTable, scope: 'pk' | 'nonpk')}
	{@const candidates = scope === 'pk' ? tbl.pk : nonPk(tbl)}
	{#each nonPk(tbl) as col (col)}
		<div class="flex flex-col gap-2 rounded-lg border p-3" data-testid="dep-{tbl.table}-{col}">
			<p class="text-sm font-medium">{t("'{column}' depends on:", { column: col })}</p>
			{@render colChecks(
				candidates.filter((c) => c !== col),
				answers[tbl.table]?.[col] ?? [],
				(v, on) => {
					answers[tbl.table] = {
						...answers[tbl.table],
						[col]: toggle(answers[tbl.table]?.[col] ?? [], v, on)
					};
				}
			)}
		</div>
	{/each}
{/snippet}

{#snippet planView(label: string, nextStep: () => void)}
	{#each plan as p (p.info.table)}
		<div class="flex flex-col gap-3">
			<p class="text-sm font-medium">
				{#if p.groups.length > 1}
					{t("To put '{table}' into the next normal form these tables are needed:", {
						table: p.info.table
					})}
				{:else}
					{t("'{table}' needs no change.", { table: p.info.table })}
				{/if}
			</p>
			{#if p.groups.length > 1}
				{#each p.groups as g (keyName(g.key))}
					<div class="flex flex-wrap items-center gap-2">
						<Input
							class="max-w-56"
							aria-label={t('Table name for {key}', { key: keyName(g.key) })}
							value={g.name}
							oninput={(e) => {
								names[p.info.table] = {
									...names[p.info.table],
									[keyName(g.key)]: e.currentTarget.value
								};
							}}
						/>
						<span class="text-sm text-muted-foreground">
							( <u>{keyName(g.key)}</u>{g.dependents.length ? ', ' + g.dependents.join(', ') : ''} )
						</span>
					</div>
				{/each}
				{@render sqlBox(p.sql.join('\n'))}
				{#if p.error}<p class="text-sm text-destructive">{p.error}</p>{/if}
			{/if}
		</div>
	{/each}
	<div class="flex gap-2">
		<Button disabled={busy} onclick={() => applyPlan(label, nextStep)} data-testid="norm-apply">
			{plan.some((p) => p.groups.length > 1) ? t('Create the tables') : t('Continue')}
		</Button>
	</div>
{/snippet}

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Layers}
		title={t('Normalization')}
		description={t('Improve the structure of {name} step by step.', { name: `${db}.${table}` })}
	/>

	{#if error}
		<Alert.Root variant="destructive" role="alert" data-testid="norm-error">
			<Alert.Title>{t('Error in processing')}</Alert.Title>
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if !started}
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Select up to what step you want to normalize')}</Card.Title>
				<Card.Description>
					{t(
						'Hint: please follow the procedure carefully in order to obtain a correct normalization.'
					)}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				{#each [['1nf', N_('First step of normalization (1NF)')], ['2nf', N_('Second step of normalization (1NF+2NF)')], ['3nf', N_('Third step of normalization (1NF+2NF+3NF)')]] as [v, label] (v)}
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" name="normalizeTo" value={v} bind:group={target} />
						{t(label)}
					</label>
				{/each}
			</Card.Content>
			<Card.Footer>
				<Button onclick={begin} data-testid="norm-go">{t('Go')}</Button>
			</Card.Footer>
		</Card.Root>
	{:else if step === '1.1'}
		<Card.Root data-testid="norm-step-1.1">
			<Card.Header>
				<Card.Title>{t('Step 1.1 Have a primary key')}</Card.Title>
				<Card.Description>
					{t(
						'There is no primary key; please add one. A primary key is a column (or combination of columns) that uniquely identify all rows.'
					)}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<div class="flex gap-4 text-sm">
					<label class="flex items-center gap-2">
						<input type="radio" name="pkMode" value="existing" bind:group={pkMode} />
						{t('Add a primary key on existing column(s)')}
					</label>
					<label class="flex items-center gap-2">
						<input type="radio" name="pkMode" value="new" bind:group={pkMode} />
						{t('Add a new primary key column')}
					</label>
				</div>
				{#if pkMode === 'existing'}
					{@render colChecks(
						info.columns.map((c) => c.name),
						pkChoice,
						(v, on) => (pkChoice = toggle(pkChoice, v, on))
					)}
				{:else}
					<ColumnEditor
						bind:columns={pkColumn}
						caps={data.caps}
						collations={data.collations}
						showIndex={false}
						showAutoIncrement
						fixed
					/>
				{/if}
				{@render sqlBox(pkSql)}
			</Card.Content>
			<Card.Footer class="gap-2">
				<Button disabled={busy || !pkSql} onclick={savePk} data-testid="norm-save-pk">
					{t('Add the primary key')}
				</Button>
				<Button variant="outline" onclick={() => (step = '1.2')}>{t('Skip')}</Button>
			</Card.Footer>
		</Card.Root>
	{:else if step === '1.2'}
		<Card.Root data-testid="norm-step-1.2">
			<Card.Header>
				<Card.Title>{t('Step 1.2 Remove redundant columns')}</Card.Title>
				<Card.Description>
					{t(
						'Do you have a group of columns which on combining gives an existing column? For example, first_name and last_name combine into full_name, which makes full_name redundant. Check the columns which are redundant and remove them.'
					)}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{#if info.pk.length}
					<p class="text-sm text-muted-foreground">
						{t('Primary key ({columns}) exists.', { columns: info.pk.join(', ') })}
					</p>
				{/if}
				{@render colChecks(
					info.columns.map((c) => c.name),
					redundant,
					(v, on) => (redundant = toggle(redundant, v, on))
				)}
				{@render sqlBox(dropSql)}
			</Card.Content>
			<Card.Footer class="gap-2">
				<Button
					disabled={busy || redundant.length === 0 || redundant.length >= info.columns.length}
					onclick={dropRedundant}
				>
					{t('Remove selected')}
				</Button>
				<Button variant="outline" onclick={() => (step = '1.3')}>{t('No redundant column')}</Button>
			</Card.Footer>
		</Card.Root>
	{:else if step === '1.3'}
		<Card.Root data-testid="norm-step-1.3">
			<Card.Header>
				<Card.Title>{t('Step 1.3 Make all columns atomic')}</Card.Title>
				<Card.Description>
					{t(
						'Do you have any column which can be split into more than one column? For example: address can be split into street, city, country and zip. The new columns are added after the chosen one; fill them from the original with an UPDATE statement.'
					)}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<div class="flex flex-wrap items-center gap-2 text-sm">
					<NativeSelect
						aria-label={t('Column to split')}
						bind:value={splitColumn}
						onchange={() => (splitCols = [])}
					>
						<option value="">{t('Select one…')}</option>
						{#each stringColumns as c (c.name)}
							<option value={c.name}>{c.name} [ {c.type} ]</option>
						{/each}
					</NativeSelect>
					{t('split into')}
					<Input
						type="number"
						class="w-20"
						aria-label={t('Number of columns')}
						bind:value={splitCount}
					/>
					<Button variant="outline" disabled={!splitColumn} onclick={prepareSplit}>{t('Go')}</Button
					>
				</div>
				{#if splitCols.length}
					<ColumnEditor
						bind:columns={splitCols}
						caps={data.caps}
						collations={data.collations}
						showIndex={false}
						fixed
					/>
					{@render sqlBox(splitSql)}
				{/if}
			</Card.Content>
			<Card.Footer class="gap-2">
				<Button disabled={busy || splitCols.length === 0} onclick={saveSplit}>
					{t('Add the columns')}
				</Button>
				<Button variant="outline" onclick={() => (step = '1.4')}>{t('No such column')}</Button>
			</Card.Footer>
		</Card.Root>
	{:else if step === '1.4'}
		<Card.Root data-testid="norm-step-1.4">
			<Card.Header>
				<Card.Title>{t('Step 1.4 Move repeating groups')}</Card.Title>
				<Card.Description>
					{t(
						'Do you have a group of two or more columns that are closely related and all repeat the same attribute? For example book_id, author1, author2, author3: a new table (book_id, author) should be created.'
					)}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{@render colChecks(
					nonPk(info),
					repeating,
					(v, on) => (repeating = toggle(repeating, v, on))
				)}
				<div class="flex flex-wrap gap-2">
					<Input class="max-w-56" placeholder={t('New table name')} bind:value={repeatTable} />
					<Input class="max-w-56" placeholder={t('New column name')} bind:value={repeatColumn} />
				</div>
				{@render sqlBox(repeatSql)}
			</Card.Content>
			<Card.Footer class="gap-2">
				<Button disabled={busy || !repeatSql} onclick={moveRepeating}>{t('Done')}</Button>
				<Button variant="outline" onclick={() => (step = afterOneNf())}
					>{t('No repeating group')}</Button
				>
			</Card.Footer>
		</Card.Root>
	{:else if step === '2.1'}
		<Card.Root data-testid="norm-step-2.1">
			<Card.Header>
				<Card.Title>{t('Step 2.1 Find partial dependencies')}</Card.Title>
				<Card.Description>
					{#if info.pk.length < 2}
						{t(
							'No partial dependencies possible as the primary key ({columns}) has just one column. The table is already in second normal form.',
							{ columns: info.pk.join(', ') }
						)}
					{:else if nonPk(info).length === 0}
						{t(
							'The primary key is composed of all the columns: the table is already in second normal form.'
						)}
					{:else}
						{t(
							'The primary key ({columns}) consists of more than one column so we need to find the partial dependencies. For each column select the minimal set of key columns whose values combined are sufficient to determine it (none: the whole key).',
							{ columns: info.pk.join(', ') }
						)}
					{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{#if info.pk.length >= 2 && nonPk(info).length > 0}
					<div>
						<Button
							variant="outline"
							disabled={busy}
							onclick={showPossible}
							data-testid="norm-show-pd"
						>
							{t('+ Show me the possible partial dependencies based on data in the table')}
						</Button>
					</div>
					{#if found}
						<div class="rounded-lg border p-3 text-sm" data-testid="norm-found">
							<p class="mb-2 text-muted-foreground">
								{t(
									"This list is based on a subset of the table's data (first 500 rows) and is not necessarily accurate."
								)}
							</p>
							{#each Object.entries(found) as [det, deps] (det)}
								<div class="flex items-center gap-2 py-1">
									<Button size="sm" variant="secondary" onclick={() => pick(det, deps)}
										>{t('Pick')}</Button
									>
									<span>{det} -> {deps.join(', ')}</span>
								</div>
							{:else}
								<p>{t('No partial dependencies found!')}</p>
							{/each}
						</div>
					{/if}
					{@render depForm(info, 'pk')}
				{/if}
			</Card.Content>
			<Card.Footer>
				<Button onclick={next2nf} data-testid="norm-next">{t('Continue')}</Button>
			</Card.Footer>
		</Card.Root>
	{:else if step === '2.2'}
		<Card.Root data-testid="norm-step-2.2">
			<Card.Header>
				<Card.Title>{t('Step 2.2 Confirm the partial dependencies')}</Card.Title>
				<Card.Description>{t('Review the tables and the SQL, then create them.')}</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{@render planView('2.2', () => skipTo3nf(tablesFor3nf.length ? tablesFor3nf : [table]))}
			</Card.Content>
			<Card.Footer>
				<Button variant="outline" onclick={() => (step = '2.1')}>{t('Back')}</Button>
			</Card.Footer>
		</Card.Root>
	{:else if step === '3.1'}
		<Card.Root data-testid="norm-step-3.1">
			<Card.Header>
				<Card.Title>{t('Step 3.1 Find transitive dependencies')}</Card.Title>
				<Card.Description>
					{t(
						'For each column select the minimal set of other columns whose values combined are sufficient to determine it. A column may have no transitive dependency: then select nothing.'
					)}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{#each tablesFor3nf as n (n)}
					<h3 class="text-sm font-semibold">{n}</h3>
					{@render depForm(infos[n], 'nonpk')}
				{:else}
					<p class="text-sm">
						{t('No transitive dependencies possible: the table is already in third normal form.')}
					</p>
				{/each}
			</Card.Content>
			<Card.Footer>
				<Button
					onclick={() => (tablesFor3nf.length ? (step = '3.2') : (step = 'done'))}
					data-testid="norm-next"
				>
					{t('Continue')}
				</Button>
			</Card.Footer>
		</Card.Root>
	{:else if step === '3.2'}
		<Card.Root data-testid="norm-step-3.2">
			<Card.Header>
				<Card.Title>{t('Step 3.2 Confirm the transitive dependencies')}</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{@render planView('3.2', () => (step = 'done'))}
			</Card.Content>
			<Card.Footer>
				<Button variant="outline" onclick={() => (step = '3.1')}>{t('Back')}</Button>
			</Card.Footer>
		</Card.Root>
	{:else}
		<Card.Root data-testid="norm-done">
			<Card.Header>
				<Card.Title>{t('The normalization is complete')}</Card.Title>
				<Card.Description>{t('Statements that were executed:')}</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				{#each log as entry, i (i)}
					<div>
						<p class="text-sm font-medium">{t('Step {step}', { step: entry.step })}</p>
						{@render sqlBox(entry.sql.join('\n'))}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">{t('No change was needed.')}</p>
				{/each}
			</Card.Content>
			<Card.Footer>
				<Button href={structureHref}>{t('Back to the structure')}</Button>
			</Card.Footer>
		</Card.Root>
	{/if}
</div>
