<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import FileUp from '@lucide/svelte/icons/file-up';
	import Upload from '@lucide/svelte/icons/upload';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { getNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import { Progress } from '#lib/components/ui/progress/index.ts';
	import { formatBytes, formatNumber } from '#lib/format.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { startImport, type ImportHandle } from '#lib/import/client.ts';
	import { parseFileName } from '#lib/import/filename.ts';
	import { FILE_CHARSETS } from '#lib/import/options.ts';
	import {
		FORMAT_LABELS,
		type ImportFormat,
		type ImportOptionValues,
		type ImportResult
	} from '#lib/import/types.ts';
	import type { ImportPageData } from '#lib/server/import/page.ts';
	import FormatOptions from './format-options.svelte';
	import ImportResultView from './import-result.svelte';

	let { data }: { data: ImportPageData } = $props();

	const navState = getNavState();
	const scope = $derived(data.scope);
	const level = $derived(scope.level);

	// ---- form state (seeded once from the configured defaults) ---------------------------------
	const initial = seedDefaults();
	function seedDefaults() {
		return data.defaults;
	}
	let file = $state<File | null>(null);
	let dragging = $state(false);
	let format = $state<ImportFormat>(
		(initial.format === 'auto' ? 'sql' : initial.format) as ImportFormat
	);
	let charset = $state(initial.charset);
	let allowInterrupt = $state(initial.allowInterrupt);
	let skipQueries = $state(initial.skipQueries);
	let fkChecks = $state(initial.fkChecks);
	let optionValues = $state<Record<ImportFormat, ImportOptionValues>>(
		JSON.parse(JSON.stringify(initial.options))
	);

	// ---- run state -----------------------------------------------------------------------------
	let phase = $state<'idle' | 'uploading' | 'processing'>('idle');
	let uploaded = $state(0);
	let serverProgress = $state({ bytes: 0, queries: 0, ms: 0 });
	let result = $state.raw<ImportResult | null>(null);
	let failure = $state<string | null>(null);
	let handle: ImportHandle | null = null;
	const busy = $derived(phase !== 'idle');

	const title = $derived(
		scope.level === 'server'
			? 'Importing into the current server'
			: scope.level === 'db'
				? `Importing into the database "${scope.db}"`
				: `Importing into the table "${scope.table}"`
	);
	const uploadPercent = $derived(
		file && file.size > 0 ? Math.min(100, Math.round((uploaded / file.size) * 100)) : 0
	);
	const formatChoices = $derived(
		data.formats.filter((f) => f !== 'ldi' || data.ldiAvailable || level === 'table')
	);

	function chooseFile(f: File | null) {
		file = f;
		result = null;
		failure = null;
		if (!f) return;
		const detected = parseFileName(f.name).format;
		if (detected && (detected !== 'ldi' || data.ldiAvailable)) format = detected;
	}

	function onInputChange(e: Event) {
		chooseFile((e.currentTarget as HTMLInputElement).files?.[0] ?? null);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const f = e.dataTransfer?.files?.[0];
		if (f) chooseFile(f);
	}

	async function submit(skip: number) {
		if (!file || busy) return;
		skipQueries = skip;
		phase = 'uploading';
		uploaded = 0;
		serverProgress = { bytes: 0, queries: 0, ms: 0 };
		result = null;
		failure = null;
		handle = startImport(
			file,
			scope,
			{
				format,
				charset,
				allow_interrupt: allowInterrupt,
				skip_queries: skip,
				fk_checks: fkChecks,
				options: $state.snapshot(optionValues[format])
			},
			{
				onUpload: (loaded, total) => {
					uploaded = loaded;
					if (loaded >= total) phase = 'processing';
				},
				onProgress: (p) => {
					phase = 'processing';
					serverProgress = p;
				}
			}
		);
		try {
			result = await handle.result;
			if (result.structureChanged) {
				await navState.reload();
				await refreshAll();
			}
		} catch (e) {
			failure = e instanceof Error ? e.message : 'The import failed.';
		} finally {
			phase = 'idle';
			handle = null;
		}
	}

	function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		void submit(skipQueries);
	}

	const maxSizeLabel = $derived(
		data.maxUploadBytes ? `(Max: ${formatBytes(data.maxUploadBytes)})` : ''
	);
	const tooBig = $derived(
		file !== null && data.maxUploadBytes !== null && file.size > data.maxUploadBytes
	);
</script>

<div class="grid gap-6">
	<PageHeader icon={FileUp} title="Import" description={title} />

	<form class="grid gap-4" onsubmit={onSubmit} data-testid="import-form">
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">File to import</Card.Title>
				<Card.Description>
					File may be compressed (gzip, zip) or uncompressed. A compressed file's name must end in <strong
						>.[format].[compression]</strong
					>. Example: <strong>.sql.zip</strong>. bzip2 files are not supported; decompress them
					first.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4">
				<div
					role="group"
					aria-label="Drop a file to import"
					class="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors {dragging
						? 'border-primary bg-primary-soft'
						: 'border-input bg-muted/40'}"
					ondragover={(e) => {
						e.preventDefault();
						dragging = true;
					}}
					ondragleave={() => (dragging = false)}
					ondrop={onDrop}
					data-testid="import-dropzone"
				>
					<Upload class="size-6 text-muted-foreground" aria-hidden="true" />
					<Label for="import-file"
						>Browse your computer or drag and drop a file here {maxSizeLabel}</Label
					>
					<Input
						id="import-file"
						name="import_file"
						type="file"
						class="max-w-md"
						onchange={onInputChange}
						data-testid="import-file"
					/>
					{#if file}
						<p class="text-sm" data-testid="import-file-info">
							<span class="font-medium">{file.name}</span>
							<span class="text-muted-foreground">({formatBytes(file.size)})</span>
						</p>
					{/if}
					{#if tooBig}
						<p class="text-sm text-destructive" role="alert">
							This file is larger than the maximum upload size of {formatBytes(
								data.maxUploadBytes
							)}.
						</p>
					{/if}
				</div>

				<div class="grid gap-1.5">
					<Label for="charset_of_file">Character set of the file:</Label>
					<NativeSelect id="charset_of_file" name="charset_of_file" bind:value={charset}>
						{#each FILE_CHARSETS as c (c.value)}
							<NativeSelectOption value={c.value}>{c.label}</NativeSelectOption>
						{/each}
					</NativeSelect>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title class="text-base">Partial import</Card.Title></Card.Header>
			<Card.Content class="grid gap-4">
				<div class="flex items-start gap-2">
					<Checkbox id="allow_interrupt" name="allow_interrupt" bind:checked={allowInterrupt} />
					<div class="grid gap-1">
						<Label for="allow_interrupt" class="leading-snug font-normal">
							Allow the interruption of an import in case the script detects it is close to the PHP
							timeout limit.
						</Label>
						<p class="text-xs text-muted-foreground">
							This might be a good way to import large files, however it can break transactions.
							{#if data.timeBudgetSeconds > 0}
								An import is interrupted after about {data.timeBudgetSeconds} seconds (ExecTimeLimit)
								and can then be continued.
							{:else}
								ExecTimeLimit is 0: imports are never interrupted.
							{/if}
						</p>
					</div>
				</div>
				<div class="grid gap-1.5">
					<Label for="skip_queries">
						Skip this number of queries (for SQL) or lines (for other formats), starting from the
						first one:
					</Label>
					<Input
						id="skip_queries"
						name="skip_queries"
						type="number"
						min="0"
						class="w-40"
						bind:value={() => skipQueries, (v) => (skipQueries = Math.max(0, Number(v) || 0))}
					/>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title class="text-base">Other options</Card.Title></Card.Header>
			<Card.Content>
				<div class="flex items-center gap-2">
					<Checkbox id="fk_checks" name="fk_checks" bind:checked={fkChecks} />
					<Label for="fk_checks" class="font-normal">Enable foreign key checks</Label>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title class="text-base">Format</Card.Title></Card.Header>
			<Card.Content class="grid gap-4">
				<NativeSelect id="format" name="format" aria-label="Format" bind:value={format}>
					{#each formatChoices as f (f)}
						<NativeSelectOption value={f} disabled={f === 'ldi' && !data.ldiAvailable}>
							{FORMAT_LABELS[f]}
						</NativeSelectOption>
					{/each}
				</NativeSelect>
				{#if format === 'ldi' || (level === 'table' && !data.ldiAvailable)}
					{#if data.ldiReason}
						<Alert variant="info" data-testid="ldi-unavailable">
							<AlertDescription>{data.ldiReason}</AlertDescription>
						</Alert>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title class="text-base">Format-specific options</Card.Title></Card.Header>
			<Card.Content>
				<FormatOptions
					{format}
					{level}
					bind:values={optionValues[format]}
					compatibilities={data.compatibilities}
				/>
			</Card.Content>
		</Card.Root>

		<div class="flex flex-wrap items-center gap-3">
			<Button
				type="submit"
				disabled={!hydration.ready || !file || busy || tooBig}
				data-testid="import-go"
			>
				Import
			</Button>
			{#if busy}
				<Button
					type="button"
					variant="outline"
					onclick={() => handle?.abort()}
					data-testid="import-cancel"
				>
					Cancel
				</Button>
			{/if}
		</div>
	</form>

	{#if busy}
		<Card.Root data-testid="import-progress">
			<Card.Content class="grid gap-2 py-1">
				{#if phase === 'uploading'}
					<p class="text-sm">
						Uploading {file?.name}: {formatBytes(uploaded)} of {formatBytes(file?.size ?? 0)}
					</p>
					<Progress value={uploadPercent} aria-label="Upload progress" />
				{:else}
					<p class="text-sm">
						Importing {file?.name}: {formatNumber(serverProgress.queries)} queries executed
						{#if serverProgress.ms > 0}in {(serverProgress.ms / 1000).toFixed(1)} s{/if}
					</p>
					<Progress
						value={file && file.size > 0
							? Math.min(100, (serverProgress.bytes / file.size) * 100)
							: 0}
						aria-label="Import progress"
					/>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if failure}
		<Alert variant="destructive" role="alert" data-testid="import-failure">
			<AlertDescription>{failure}</AlertDescription>
		</Alert>
	{/if}

	{#if result}
		<ImportResultView {result} {scope} {busy} onContinue={(skip) => submit(skip)} />
	{/if}
</div>
