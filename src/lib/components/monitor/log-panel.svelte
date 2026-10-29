<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import { groupQueries, type GeneralLogRow, type SlowLogRow } from '#lib/monitor/log.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';

	type Vars = Record<'general_log' | 'slow_query_log' | 'long_query_time' | 'log_output', string>;

	interface Props {
		vars: Vars;
		/** Selected range, ms since epoch. */
		selection: { start: number; end: number } | null;
	}

	const { t } = useI18n();
	let { vars: initial, selection }: Props = $props();

	let updated = $state<Vars | null>(null);
	const vars = $derived(updated ?? initial);
	let busy = $state(false);
	let error = $state('');
	let result = $state<{
		type: 'slow' | 'general';
		rows: (SlowLogRow & GeneralLogRow)[];
		sum: Record<string, number>;
		numRows: number;
	} | null>(null);
	let groupSimilar = $state(true);
	let limitTypes = $state(false);
	let groupInserts = $state(false);

	const on = (v: string) => /^(on|1)$/i.test(v);
	const toTable = $derived(/table/i.test(vars.log_output));
	const clock = (ms: number) => new Date(ms).toLocaleTimeString();

	async function post<T>(path: string, body: unknown): Promise<T | null> {
		busy = true;
		error = '';
		try {
			const res = await fetch(resolve(bare(`/server/status/monitor/${path}`)), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				error =
					json.error ?? json.message ?? t('Request failed ({status})', { status: res.status });
				return null;
			}
			return json as T;
		} catch {
			error = t('Request failed');
			return null;
		} finally {
			busy = false;
		}
	}

	async function setVar(name: keyof Vars, value: string): Promise<boolean> {
		const r = await post<{ vars: Vars }>('logging', { name, value });
		if (!r) return false;
		updated = r.vars;
		return true;
	}

	async function toggle(name: 'slow_query_log' | 'general_log', enable: boolean) {
		// The log tables are only filled when log_output includes TABLE.
		if (enable && !toTable && !(await setVar('log_output', 'TABLE'))) return;
		await setVar(name, enable ? 'ON' : 'OFF');
	}

	async function load(type: 'slow' | 'general') {
		if (!selection) return;
		result = null;
		const r = await post<NonNullable<typeof result>>('log', {
			type,
			start: Math.floor(selection.start / 1000),
			end: Math.ceil(selection.end / 1000),
			limitTypes,
			groupInserts
		});
		if (r) result = r;
	}

	const grouped = $derived(
		result
			? groupQueries(
					result.rows.map((r) => ({
						sql: result!.type === 'slow' ? r.sql_text : r.argument,
						count: r.count,
						time: result!.type === 'slow' ? r.query_time : undefined,
						rowsSent: r.rows_sent,
						rowsExamined: r.rows_examined
					})),
					true
				)
			: []
	);

	// Query analyser
	let analyzeOpen = $state(false);
	let analyzeQuery = $state('');
	let analysis = $state<{
		explain: Record<string, unknown>[] | null;
		profiling: { seq: number; state: string; duration: number }[] | null;
		error: string | null;
		executed: boolean;
	} | null>(null);

	async function analyze(query: string, db = '') {
		analyzeQuery = query;
		analysis = null;
		analyzeOpen = true;
		analysis = await post<NonNullable<typeof analysis>>('analyze', { database: db, query });
	}
</script>

<Card.Root data-testid="log-panel">
	<Card.Header>
		<Card.Title>{t('Log analysis')}</Card.Title>
		<Card.Description>
			{t(
				'Switch on the slow or general log (written to the mysql log tables), select a time range on a chart by dragging and load the entries of that range.'
			)}
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		<div class="flex flex-wrap items-center gap-x-6 gap-y-3">
			<div class="flex items-center gap-2">
				<Switch
					id="slow-log"
					checked={on(vars.slow_query_log)}
					disabled={busy}
					onCheckedChange={(v) => toggle('slow_query_log', v)}
				/>
				<Label for="slow-log">{t('Slow query log')}</Label>
			</div>
			<div class="flex items-center gap-2">
				<Switch
					id="general-log"
					checked={on(vars.general_log)}
					disabled={busy}
					onCheckedChange={(v) => toggle('general_log', v)}
				/>
				<Label for="general-log">{t('General log')}</Label>
			</div>
			<Badge variant={toTable ? 'success' : 'warning'} data-testid="log-output">
				log_output = {vars.log_output || '?'}
			</Badge>
			<Badge variant="muted">long_query_time = {vars.long_query_time}s</Badge>
		</div>

		<div class="flex flex-wrap items-center gap-3" data-testid="selection">
			{#if selection}
				<span class="text-sm">
					{t('Selected range: {start} to {end}', {
						start: clock(selection.start),
						end: clock(selection.end)
					})}
				</span>
			{:else}
				<span class="text-sm text-muted-foreground">{t('No range selected.')}</span>
			{/if}
			<Button
				variant="outline"
				size="sm"
				disabled={!selection || busy}
				onclick={() => load('slow')}
				data-testid="load-slow">{t('Load slow log')}</Button
			>
			<Button
				variant="outline"
				size="sm"
				disabled={!selection || busy}
				onclick={() => load('general')}
				data-testid="load-general">{t('Load general log')}</Button
			>
			<div class="flex items-center gap-2">
				<Checkbox id="group-similar" bind:checked={groupSimilar} />
				<Label for="group-similar">{t('Group queries (ignore literal values)')}</Label>
			</div>
			<div class="flex items-center gap-2">
				<Checkbox id="limit-types" bind:checked={limitTypes} />
				<Label for="limit-types">{t('Only SELECT, INSERT, UPDATE, DELETE (general log)')}</Label>
			</div>
			<div class="flex items-center gap-2">
				<Checkbox id="group-inserts" bind:checked={groupInserts} />
				<Label for="group-inserts">{t('Group INSERTs per table (general log)')}</Label>
			</div>
		</div>

		{#if error}
			<p class="text-sm text-destructive" role="alert" data-testid="log-error">{error}</p>
		{/if}

		{#if result}
			<div class="flex flex-wrap items-center gap-2" data-testid="log-summary">
				{#each Object.entries(result.sum) as [type, n] (type)}
					<Badge variant={type === 'TOTAL' ? 'primary' : 'muted'}>{type || '?'}: {n}</Badge>
				{/each}
			</div>
			{#if result.numRows === 0}
				<p class="text-sm text-muted-foreground">{t('No entries in the selected range.')}</p>
			{:else if groupSimilar}
				<Table.Root data-testid="log-grouped">
					<Table.Header>
						<Table.Row>
							<Table.Head class="w-20">{t('Count')}</Table.Head>
							{#if result.type === 'slow'}
								<Table.Head class="w-28">{t('Total time (s)')}</Table.Head>
								<Table.Head class="w-28">{t('Max time (s)')}</Table.Head>
							{/if}
							<Table.Head>{t('Query')}</Table.Head>
							<Table.Head class="w-24"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each grouped as g (g.query)}
							<Table.Row>
								<Table.Cell>{g.count}</Table.Cell>
								{#if result.type === 'slow'}
									<Table.Cell>{g.totalTime.toFixed(3)}</Table.Cell>
									<Table.Cell>{g.maxTime.toFixed(3)}</Table.Cell>
								{/if}
								<Table.Cell class="font-mono text-xs whitespace-pre-wrap">{g.query}</Table.Cell>
								<Table.Cell>
									<Button variant="outline" size="xs" onclick={() => analyze(g.query)}
										>{t('Analyse query')}</Button
									>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{:else}
				<Table.Root data-testid="log-rows">
					<Table.Header>
						<Table.Row>
							<Table.Head class="w-24">{t('Time')}</Table.Head>
							<Table.Head class="w-20">{t('Count')}</Table.Head>
							{#if result.type === 'slow'}
								<Table.Head class="w-28">{t('Query time')}</Table.Head>
								<Table.Head class="w-28">{t('Lock time')}</Table.Head>
								<Table.Head>{t('Rows sent / examined')}</Table.Head>
							{/if}
							<Table.Head>{t('Query')}</Table.Head>
							<Table.Head class="w-24"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each result.rows as r, i (i)}
							{@const sql = result.type === 'slow' ? r.sql_text : r.argument}
							<Table.Row>
								<Table.Cell>{result.type === 'slow' ? r.start_time : r.event_time}</Table.Cell>
								<Table.Cell>{r.count}</Table.Cell>
								{#if result.type === 'slow'}
									<Table.Cell>{r.query_time}</Table.Cell>
									<Table.Cell>{r.lock_time}</Table.Cell>
									<Table.Cell>{r.rows_sent} / {r.rows_examined}</Table.Cell>
								{/if}
								<Table.Cell class="font-mono text-xs whitespace-pre-wrap">{sql}</Table.Cell>
								<Table.Cell>
									<Button
										variant="outline"
										size="xs"
										onclick={() => analyze(sql, result?.type === 'slow' ? r.db : '')}
										>{t('Analyse query')}</Button
									>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>

<Dialog.Root bind:open={analyzeOpen}>
	<Dialog.Content class="sm:max-w-3xl" data-testid="analyze-dialog">
		<Dialog.Header>
			<Dialog.Title>{t('Analyse query')}</Dialog.Title>
			<Dialog.Description
				>{t('EXPLAIN output and, for SELECT statements, the profiling.')}</Dialog.Description
			>
		</Dialog.Header>
		<pre
			class="max-h-32 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{analyzeQuery}</pre>
		{#if !analysis}
			<p class="text-sm text-muted-foreground">{t('Analysing…')}</p>
		{:else}
			{#if analysis.error}
				<p class="text-sm text-destructive" role="alert">{analysis.error}</p>
			{/if}
			{#if analysis.explain?.length}
				<div class="overflow-auto">
					<Table.Root data-testid="explain">
						<Table.Header>
							<Table.Row>
								{#each Object.keys(analysis.explain[0]) as c (c)}
									<Table.Head>{c}</Table.Head>
								{/each}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each analysis.explain as row, i (i)}
								<Table.Row>
									{#each Object.values(row) as v, j (j)}
										<Table.Cell class="text-xs">{v ?? 'NULL'}</Table.Cell>
									{/each}
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
			{#if analysis.profiling?.length}
				<Table.Root data-testid="profiling">
					<Table.Header>
						<Table.Row>
							<Table.Head>{t('State')}</Table.Head>
							<Table.Head>{t('Duration (s)')}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each analysis.profiling as p (p.seq)}
							<Table.Row>
								<Table.Cell class="text-xs">{p.state}</Table.Cell>
								<Table.Cell class="text-xs">{p.duration}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{:else if analysis.executed}
				<p class="text-xs text-muted-foreground">
					{t('Profiling is not available on this server.')}
				</p>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
