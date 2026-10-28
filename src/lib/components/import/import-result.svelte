<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { formatBytes, formatNumber } from '#lib/format.ts';
	import { FORMAT_LABELS, type ImportResult, type ImportScope } from '#lib/import/types.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';

	interface Props {
		result: ImportResult;
		scope: ImportScope;
		busy: boolean;
		/** Re-run the same file with this skip count. */
		onContinue: (skip: number) => void;
	}

	let { result, scope, busy, onContinue }: Props = $props();

	const enc = encodeURIComponent;
	const seconds = $derived((result.durationMs / 1000).toFixed(result.durationMs < 10_000 ? 2 : 1));
	const variant = $derived(result.ok ? 'success' : result.interrupted ? 'warning' : 'destructive');
	const title = $derived(
		result.ok
			? 'Import has been successfully finished'
			: result.interrupted
				? 'Import interrupted'
				: 'Import failed'
	);
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are built from encoded names of the current server -->
<section class="grid gap-4" aria-live="polite" data-testid="import-result">
	<Alert {variant} role={result.ok ? 'status' : 'alert'}>
		{#if result.ok}
			<CircleCheck />
		{:else if result.interrupted}
			<TriangleAlert />
		{:else}
			<CircleAlert />
		{/if}
		<AlertTitle>{title}</AlertTitle>
		<AlertDescription data-testid="import-message">
			<p>{result.message}</p>
			{#if result.error?.line}
				<p class="mt-1" data-testid="import-error-line">
					Error at line <strong>{result.error.line}</strong>{result.error.errno
						? ` (error ${result.error.errno})`
						: ''}.
				</p>
			{/if}
			{#if result.error?.statement}
				<pre
					class="mt-2 max-h-40 overflow-auto rounded-md bg-background/70 p-2 font-mono text-xs whitespace-pre-wrap text-foreground"
					data-testid="import-error-statement">{result.error.statement}</pre>
			{/if}
		</AlertDescription>
	</Alert>

	<div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
		<Badge variant="muted">{FORMAT_LABELS[result.format]}</Badge>
		{#if result.compression !== 'none'}<Badge variant="muted">{result.compression}</Badge>{/if}
		<span>{formatNumber(result.queries)} queries executed</span>
		{#if result.skipped > 0}<span>· {formatNumber(result.skipped)} skipped</span>{/if}
		{#if result.affectedRows > 0}<span>· {formatNumber(result.affectedRows)} rows affected</span
			>{/if}
		<span>· {formatBytes(result.bytesRead)} read in {seconds} s</span>
	</div>

	{#if result.resumeSkip !== null}
		<div class="flex flex-wrap gap-2">
			<Button
				disabled={!hydration.ready || busy}
				onclick={() => onContinue(result.resumeSkip!)}
				data-testid="import-continue"
			>
				{result.interrupted
					? `Continue the import (skip ${result.resumeSkip} queries)`
					: `Skip the failed query and continue (skip ${result.resumeSkip} queries)`}
			</Button>
			{#if result.retrySkip !== null}
				<Button
					variant="outline"
					disabled={!hydration.ready || busy}
					onclick={() => onContinue(result.retrySkip!)}
					data-testid="import-retry"
				>
					Retry the failed query (skip {result.retrySkip} queries)
				</Button>
			{/if}
		</div>
	{/if}

	{#if result.created.length > 0}
		<Card.Root class="gap-3 py-4">
			<Card.Header class="py-0">
				<Card.Title class="text-base"
					>The following structures have been created or altered</Card.Title
				>
			</Card.Header>
			<Card.Content class="grid gap-2 text-sm" data-testid="import-created">
				{#each result.created as c (c.db)}
					<div>
						<a class="font-medium text-primary hover:underline" href="/db/{enc(c.db)}/structure"
							>{c.db}</a
						>
						{#if c.tables.length > 0}
							<ul class="mt-1 flex flex-wrap gap-2">
								{#each c.tables as t (t)}
									<li>
										<a
											class="rounded-md bg-primary-soft px-2 py-0.5 font-mono text-xs text-primary hover:underline"
											href="/db/{enc(c.db)}/table/{enc(t)}/browse">{t}</a
										>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if scope.level === 'table'}
		<div>
			<Button
				variant="outline"
				href="/db/{enc(scope.db)}/table/{enc(scope.table)}/browse"
				data-testid="import-browse"
			>
				Browse table {scope.table}
			</Button>
		</div>
	{/if}

	{#if result.warnings.length > 0}
		<Alert variant="warning">
			<TriangleAlert />
			<AlertTitle>Warnings ({result.warnings.length})</AlertTitle>
			<AlertDescription>
				<ul class="list-disc ps-4">
					{#each result.warnings as w, i (i)}
						<li>{w.level} {w.code}: {w.message}{w.line ? ` (line ${w.line})` : ''}</li>
					{/each}
				</ul>
			</AlertDescription>
		</Alert>
	{/if}

	{#if result.statements.length > 0}
		<details class="rounded-xl border bg-card" data-testid="import-statements">
			<summary class="cursor-pointer px-4 py-3 text-sm font-medium">
				Executed statements
				{#if result.statementsTruncated}(first {result.statements.length}){/if}
			</summary>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-16 text-end">Line</Table.Head>
						<Table.Head>Statement</Table.Head>
						<Table.Head class="text-end">Result</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each result.statements as s, i (i)}
						<Table.Row>
							<Table.Cell class="text-end text-muted-foreground tabular-nums"
								>{s.line ?? ''}</Table.Cell
							>
							<Table.Cell class="max-w-xl truncate font-mono text-xs">{s.sql}</Table.Cell>
							<Table.Cell class="text-end text-xs whitespace-nowrap">
								{#if s.rows !== null}{s.rows} rows{:else}{s.affectedRows} affected{/if}
								{#if s.warnings > 0}· {s.warnings} warnings{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</details>
	{/if}
</section>
