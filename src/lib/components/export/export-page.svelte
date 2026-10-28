<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import { toast } from 'svelte-sonner';
	import { untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import { RadioGroup, RadioGroupItem } from '#lib/components/ui/radio-group/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import type { ExportOption } from '#lib/server/export/types.ts';

	interface PluginInfo {
		id: string;
		label: string;
		extension: string;
		binary: boolean;
		fixedStructure: boolean;
		supports: { structure: boolean; data: boolean };
		options: ExportOption[];
	}
	interface PageData {
		level: 'server' | 'database' | 'table';
		scope: string;
		db: string;
		table: string;
		action: string;
		plugins: PluginInfo[];
		defaults: Record<string, string | boolean | string[]>;
		charsets: string[];
		databases: { name: string; checked: boolean }[];
		tables: { name: string; kind: 'table' | 'view'; rows: number | null }[];
		sqlQuery: string;
		selectedRows: { where: string; sig: string }[];
		templates: { id: number; name: string }[] | null;
	}

	let { data }: { data: PageData } = $props();

	// ---- form state (keys are the phpMyAdmin form field names) ----------------------------------
	const initial = (() => {
		const bools: Record<string, boolean> = {};
		const texts: Record<string, string> = {};
		for (const [k, v] of Object.entries(data.defaults)) {
			if (typeof v === 'boolean') bools[k] = v;
			else if (typeof v === 'string') texts[k] = v;
		}
		return { bools, texts };
	})();
	let bools = $state<Record<string, boolean>>(initial.bools);
	let texts = $state<Record<string, string>>(initial.texts);
	let selDbs = $state<string[]>(
		untrack(() => data.databases.filter((d) => d.checked).map((d) => d.name))
	);
	let selStructure = $state<string[]>(untrack(() => data.tables.map((t) => t.name)));
	let selData = $state<string[]>(
		untrack(() => data.tables.filter((t) => t.kind === 'table').map((t) => t.name))
	);

	const plugin = $derived(data.plugins.find((p) => p.id === texts.what) ?? data.plugins[0]);
	const custom = $derived(texts.quick_or_custom === 'custom');
	const hasRows = $derived(data.level === 'table' && !data.selectedRows.length && !data.sqlQuery);

	$effect(() => {
		if (plugin?.binary && texts.output_format === 'astext') texts.output_format = 'sendit';
	});

	const GROUP_TITLES: Record<string, string> = {
		general: 'General options',
		structure: 'Object creation options',
		data: 'Data creation options'
	};
	function groups(p: PluginInfo): { title: string; options: ExportOption[] }[] {
		const map = new SvelteMap<string, ExportOption[]>();
		for (const o of p.options) {
			if (o.name === 'structure_or_data') continue; // rendered as the "Dump table" card
			const g = o.group ?? 'general';
			map.set(g, [...(map.get(g) ?? []), o]);
		}
		return [...map].map(([g, options]) => ({
			title: GROUP_TITLES[g] ?? g.charAt(0).toUpperCase() + g.slice(1),
			options
		}));
	}

	const title = $derived(
		data.level === 'server'
			? 'Exporting databases from the current server'
			: data.level === 'database'
				? `Exporting tables from "${data.db}" database`
				: `Exporting rows from "${data.table}" table`
	);

	function toggle(list: string[], name: string, on: boolean): string[] {
		return on ? [...new Set([...list, name])] : list.filter((n) => n !== name);
	}

	// ---- templates -------------------------------------------------------------------------------
	let templates = $state(untrack(() => data.templates));
	let templateId = $state('');
	let templateName = $state('');

	function snapshot(): Record<string, string | boolean | null | string[]> {
		const out: Record<string, string | null | string[]> = {};
		for (const [k, v] of Object.entries(texts)) out[k] = v;
		for (const [k, v] of Object.entries(bools)) out[k] = v ? 'something' : null;
		if (data.level === 'server') out['db_select[]'] = selDbs;
		if (data.level === 'database') {
			out['table_structure[]'] = selStructure;
			out['table_data[]'] = selData;
		}
		return out;
	}
	function apply(stored: Record<string, unknown>) {
		for (const [k, v] of Object.entries(stored)) {
			if (k in bools) bools[k] = v !== null && v !== false && v !== '';
			else if (k in texts && (typeof v === 'string' || typeof v === 'number')) texts[k] = String(v);
			else if (k === 'db_select[]' && Array.isArray(v)) selDbs = v.map(String);
			else if (k === 'table_structure[]' && Array.isArray(v)) selStructure = v.map(String);
			else if (k === 'table_data[]' && Array.isArray(v)) selData = v.map(String);
		}
	}
	async function templateCall(body: Record<string, unknown>) {
		const res = await fetch(`${data.action}/template`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const json = (await res.json()) as {
			ok: boolean;
			message: string;
			id?: number;
			data?: Record<string, unknown>;
			templates?: { id: number; name: string }[];
		};
		if (!json.ok) toast.error(json.message);
		else {
			toast.success(json.message);
			if (json.templates) templates = json.templates;
		}
		return json;
	}
	async function createTemplate() {
		if (!templateName.trim()) return toast.error('Enter a template name.');
		const r = await templateCall({ action: 'create', name: templateName.trim(), data: snapshot() });
		if (r.ok) {
			templateId = String(r.id);
			templateName = '';
		}
	}
	async function loadTemplate() {
		if (!templateId) return;
		const r = await templateCall({ action: 'load', id: Number(templateId) });
		if (r.ok && r.data) apply(r.data);
	}
	async function updateTemplate() {
		if (templateId)
			await templateCall({ action: 'update', id: Number(templateId), data: snapshot() });
	}
	async function deleteTemplate() {
		if (!templateId) return;
		const r = await templateCall({ action: 'delete', id: Number(templateId) });
		if (r.ok) templateId = '';
	}

	// ---- submit ----------------------------------------------------------------------------------
	let form = $state<HTMLFormElement>();
	let busy = $state(false);
	let result = $state<{ text: string; truncated: boolean } | null>(null);

	async function onsubmit(event: SubmitEvent) {
		if (texts.output_format !== 'astext' || !form) return; // native POST = file download
		event.preventDefault();
		busy = true;
		result = null;
		try {
			const res = await fetch(`${data.action}/run`, {
				method: 'POST',
				body: new FormData(form),
				headers: { accept: 'application/json' }
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				toast.error(body?.message ?? 'Export failed.');
			} else {
				result = await res.json();
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Export - svelteMyAdmin</title>
</svelte:head>

{#snippet optionControl(p: PluginInfo, o: ExportOption)}
	{@const name = `${p.id}_${o.name}`}
	{#if o.kind === 'bool'}
		<div class="flex items-start gap-2">
			<Checkbox id={name} {name} value="something" bind:checked={bools[name]} class="mt-0.5" />
			<Label for={name} class="leading-snug font-normal">{o.label}</Label>
		</div>
	{:else if o.kind === 'text' || o.kind === 'number'}
		<div class="flex flex-col gap-1.5">
			<Label for={name} class="font-normal">{o.label}</Label>
			<Input
				id={name}
				{name}
				type={o.kind === 'number' ? 'number' : 'text'}
				bind:value={texts[name]}
			/>
		</div>
	{:else if o.kind === 'select'}
		<div class="flex flex-col gap-1.5">
			<Label for={name} class="font-normal">{o.label}</Label>
			<NativeSelect id={name} {name} bind:value={texts[name]} class="max-w-xs">
				{#each o.choices as c (c.value)}
					<NativeSelectOption value={c.value}>{c.label}</NativeSelectOption>
				{/each}
			</NativeSelect>
		</div>
	{:else}
		<div class="flex flex-col gap-1.5">
			<span class="text-sm">{o.label}</span>
			<RadioGroup {name} bind:value={texts[name]}>
				{#each o.choices as c (c.value)}
					<div class="flex items-start gap-2">
						<RadioGroupItem value={c.value} id={`${name}_${c.value}`} class="mt-0.5" />
						<Label for={`${name}_${c.value}`} class="leading-snug font-normal">{c.label}</Label>
					</div>
				{/each}
			</RadioGroup>
		</div>
	{/if}
{/snippet}

<div class="flex flex-col gap-6" data-testid="export-page">
	<PageHeader {title} icon={Download} />

	{#if data.sqlQuery}
		<Alert>
			<AlertDescription>
				Exporting the result of this query:
				<code
					class="mt-1 block font-mono text-xs break-all whitespace-pre-wrap"
					data-testid="export-query">{data.sqlQuery}</code
				>
			</AlertDescription>
		</Alert>
	{/if}
	{#if data.selectedRows.length}
		<Alert>
			<AlertDescription data-testid="export-selected-rows">
				Exporting {data.selectedRows.length} selected row{data.selectedRows.length === 1
					? ''
					: 's'}.
			</AlertDescription>
		</Alert>
	{/if}

	<form
		method="POST"
		action={`${data.action}/run`}
		bind:this={form}
		{onsubmit}
		class="flex flex-col gap-6"
		data-testid="export-form"
	>
		{#if data.sqlQuery}
			<input type="hidden" name="sql_query" value={data.sqlQuery} />
		{/if}
		{#each data.selectedRows as row (row.where)}
			<input type="hidden" name="where[]" value={row.where} />
			<input type="hidden" name="sig[]" value={row.sig} />
		{/each}

		<Card.Root>
			<Card.Header><Card.Title>Export method</Card.Title></Card.Header>
			<Card.Content>
				<RadioGroup name="quick_or_custom" bind:value={texts.quick_or_custom}>
					<div class="flex items-center gap-2">
						<RadioGroupItem value="quick" id="method_quick" />
						<Label for="method_quick" class="font-normal"
							>Quick - display only the minimal options</Label
						>
					</div>
					<div class="flex items-center gap-2">
						<RadioGroupItem value="custom" id="method_custom" />
						<Label for="method_custom" class="font-normal"
							>Custom - display all possible options</Label
						>
					</div>
				</RadioGroup>
			</Card.Content>
		</Card.Root>

		{#if templates !== null}
			<Card.Root class={custom ? '' : 'hidden'} data-testid="export-templates">
				<Card.Header><Card.Title>Export templates</Card.Title></Card.Header>
				<Card.Content class="flex flex-col gap-4">
					<div class="flex flex-wrap items-end gap-2">
						<div class="flex flex-col gap-1.5">
							<Label for="template_name">New template</Label>
							<Input
								id="template_name"
								bind:value={templateName}
								placeholder="Template name"
								class="w-56"
							/>
						</div>
						<Button type="button" variant="outline" onclick={createTemplate}>Create</Button>
					</div>
					<div class="flex flex-wrap items-end gap-2">
						<div class="flex flex-col gap-1.5">
							<Label for="template_select">Existing templates</Label>
							<NativeSelect id="template_select" bind:value={templateId} class="w-56">
								<NativeSelectOption value="">Select a template</NativeSelectOption>
								{#each templates as t (t.id)}
									<NativeSelectOption value={String(t.id)}>{t.name}</NativeSelectOption>
								{/each}
							</NativeSelect>
						</div>
						<Button type="button" variant="outline" disabled={!templateId} onclick={loadTemplate}
							>Load</Button
						>
						<Button type="button" variant="outline" disabled={!templateId} onclick={updateTemplate}
							>Update</Button
						>
						<Button type="button" variant="outline" disabled={!templateId} onclick={deleteTemplate}
							>Delete</Button
						>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header><Card.Title>Format</Card.Title></Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<NativeSelect
					name="what"
					aria-label="File format to export"
					bind:value={texts.what}
					class="max-w-xs"
				>
					{#each data.plugins as p (p.id)}
						<NativeSelectOption value={p.id}>{p.label}</NativeSelectOption>
					{/each}
				</NativeSelect>
			</Card.Content>
		</Card.Root>

		{#if data.level === 'server'}
			<Card.Root class={custom ? '' : 'hidden'}>
				<Card.Header><Card.Title>Databases</Card.Title></Card.Header>
				<Card.Content class="flex flex-col gap-2">
					<div class="flex gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onclick={() => (selDbs = data.databases.map((d) => d.name))}>Select all</Button
						>
						<Button type="button" variant="outline" size="sm" onclick={() => (selDbs = [])}
							>Unselect all</Button
						>
					</div>
					{#each data.databases as d (d.name)}
						<div class="flex items-center gap-2">
							<Checkbox
								id={`db_${d.name}`}
								name="db_select[]"
								value={d.name}
								checked={selDbs.includes(d.name)}
								onCheckedChange={(v) => (selDbs = toggle(selDbs, d.name, v))}
							/>
							<Label for={`db_${d.name}`} class="font-normal">{d.name}</Label>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		{:else if data.level === 'database'}
			<Card.Root class={custom ? '' : 'hidden'}>
				<Card.Header><Card.Title>Tables</Card.Title></Card.Header>
				<Card.Content class="flex flex-col gap-2">
					<div class="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onclick={() => (selStructure = data.tables.map((t) => t.name))}
							>Select all structure</Button
						>
						<Button type="button" variant="outline" size="sm" onclick={() => (selStructure = [])}
							>Unselect all structure</Button
						>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onclick={() =>
								(selData = data.tables.filter((t) => t.kind === 'table').map((t) => t.name))}
							>Select all data</Button
						>
						<Button type="button" variant="outline" size="sm" onclick={() => (selData = [])}
							>Unselect all data</Button
						>
					</div>
					<table class="w-full text-sm" data-testid="export-tables">
						<thead>
							<tr class="border-b text-left text-muted-foreground">
								<th class="py-2 font-medium">Table</th>
								<th class="py-2 font-medium">Structure</th>
								<th class="py-2 font-medium">Data</th>
							</tr>
						</thead>
						<tbody>
							{#each data.tables as t (t.name)}
								<tr class="border-b last:border-0">
									<td class="py-2">{t.name}{t.kind === 'view' ? ' (view)' : ''}</td>
									<td class="py-2">
										<Checkbox
											aria-label={`Structure of ${t.name}`}
											name="table_structure[]"
											value={t.name}
											checked={selStructure.includes(t.name)}
											onCheckedChange={(v) => (selStructure = toggle(selStructure, t.name, v))}
										/>
									</td>
									<td class="py-2">
										{#if t.kind === 'table'}
											<Checkbox
												aria-label={`Data of ${t.name}`}
												name="table_data[]"
												value={t.name}
												checked={selData.includes(t.name)}
												onCheckedChange={(v) => (selData = toggle(selData, t.name, v))}
											/>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if hasRows}
			<Card.Root class={custom ? '' : 'hidden'}>
				<Card.Header><Card.Title>Rows</Card.Title></Card.Header>
				<Card.Content>
					<RadioGroup name="allrows" bind:value={texts.allrows}>
						<div class="flex items-center gap-2">
							<RadioGroupItem value="1" id="allrows_1" />
							<Label for="allrows_1" class="font-normal">Dump all rows</Label>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<RadioGroupItem value="0" id="allrows_0" />
							<Label for="allrows_0" class="font-normal">Dump some row(s)</Label>
							<Label for="limit_to" class="font-normal">Number of rows:</Label>
							<Input
								id="limit_to"
								name="limit_to"
								type="number"
								min="1"
								bind:value={texts.limit_to}
								class="w-28"
								onfocus={() => (texts.allrows = '0')}
							/>
							<Label for="limit_from" class="font-normal">Row to begin at:</Label>
							<Input
								id="limit_from"
								name="limit_from"
								type="number"
								min="0"
								bind:value={texts.limit_from}
								class="w-28"
							/>
						</div>
					</RadioGroup>
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root class={custom ? '' : 'hidden'}>
			<Card.Header><Card.Title>Output</Card.Title></Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<RadioGroup name="output_format" bind:value={texts.output_format}>
					<div class="flex items-center gap-2">
						<RadioGroupItem value="astext" id="output_astext" disabled={plugin?.binary} />
						<Label for="output_astext" class="font-normal">View output as text</Label>
					</div>
					<div class="flex items-center gap-2">
						<RadioGroupItem value="sendit" id="output_sendit" />
						<Label for="output_sendit" class="font-normal">Save output to a file</Label>
					</div>
				</RadioGroup>
				<div class="flex flex-col gap-1.5">
					<Label for="filename_template">File name template</Label>
					<Input
						id="filename_template"
						name="filename_template"
						bind:value={texts.filename_template}
						class="max-w-md"
					/>
					<span class="text-xs text-muted-foreground">
						<code>@SERVER@</code>, <code>@DATABASE@</code>, <code>@TABLE@</code> and date tokens
						such as <code>%Y-%m-%d</code> are replaced.
					</span>
				</div>
				<div class="flex flex-wrap gap-6">
					<div class="flex flex-col gap-1.5">
						<Label for="charset">Character set of the file</Label>
						<NativeSelect id="charset" name="charset" bind:value={texts.charset}>
							{#each data.charsets as c (c)}
								<NativeSelectOption value={c}>{c}</NativeSelectOption>
							{/each}
						</NativeSelect>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="compression">Compression</Label>
						<NativeSelect id="compression" name="compression" bind:value={texts.compression}>
							<NativeSelectOption value="none">None</NativeSelectOption>
							<NativeSelectOption value="zip">zipped</NativeSelectOption>
							<NativeSelectOption value="gzip">gzipped</NativeSelectOption>
						</NativeSelect>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<Checkbox
						id="remember_template"
						name="remember_template"
						value="something"
						bind:checked={bools.remember_template}
					/>
					<Label for="remember_template" class="font-normal">Use this for future exports</Label>
				</div>
			</Card.Content>
		</Card.Root>

		{#each data.plugins as p (p.id)}
			<div
				class={custom && texts.what === p.id ? 'flex flex-col gap-6' : 'hidden'}
				data-testid={`options-${p.id}`}
			>
				{#if p.supports.structure && p.supports.data && data.scope !== 'raw' && !p.fixedStructure}
					<Card.Root>
						<Card.Header><Card.Title>Dump table</Card.Title></Card.Header>
						<Card.Content>
							<RadioGroup
								name={`${p.id}_structure_or_data`}
								bind:value={texts[`${p.id}_structure_or_data`]}
							>
								{#each [['structure', 'structure'], ['data', 'data'], ['structure_and_data', 'structure and data']] as [v, label] (v)}
									<div class="flex items-center gap-2">
										<RadioGroupItem value={v} id={`${p.id}_sod_${v}`} />
										<Label for={`${p.id}_sod_${v}`} class="font-normal">{label}</Label>
									</div>
								{/each}
							</RadioGroup>
						</Card.Content>
					</Card.Root>
				{/if}
				{#if p.options.length}
					{#each groups(p) as g (g.title)}
						<Card.Root>
							<Card.Header><Card.Title>{p.label}: {g.title}</Card.Title></Card.Header>
							<Card.Content class="flex flex-col gap-3">
								{#each g.options as o (o.name)}
									{@render optionControl(p, o)}
								{/each}
							</Card.Content>
						</Card.Root>
					{/each}
				{/if}
			</div>
		{/each}

		<div class="flex justify-end">
			<Button type="submit" disabled={busy} data-testid="export-submit">Export</Button>
		</div>
	</form>

	{#if result}
		<Card.Root data-testid="export-result-card">
			<Card.Header><Card.Title>Output</Card.Title></Card.Header>
			<Card.Content class="flex flex-col gap-3">
				{#if result.truncated}
					<Alert
						><AlertDescription
							>The output was cut after a limit; use "Save output to a file" for the full export.</AlertDescription
						></Alert
					>
				{/if}
				<Textarea
					readonly
					rows={20}
					value={result.text}
					class="font-mono text-xs"
					data-testid="export-result"
				/>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
