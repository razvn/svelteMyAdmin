<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import InsertForm, { type SaveResult } from '#lib/components/table/insert-form.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import * as Collapsible from '#lib/components/ui/collapsible/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	let { data }: PageProps = $props();

	let result = $state<SaveResult | null>(null);

	const title = $derived(
		data.mode === 'edit' ? t('Edit row') : data.mode === 'copy' ? t('Copy row') : t('Insert')
	);
</script>

<svelte:head>
	<title>{title} - {page.params.table} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-4 p-4 md:p-6">
	<PageHeader {title} description={t('Table {table}', { table: page.params.table ?? '' })} />

	{#each data.missing as clause (clause)}
		<Alert.Root variant="warning">
			<Alert.Description>
				{t('MySQL returned an empty result set (i.e. zero rows).')}
				<code class="font-mono">{clause}</code>
			</Alert.Description>
		</Alert.Root>
	{/each}

	{#if result}
		<Alert.Root
			variant={result.kind === 'error'
				? 'destructive'
				: result.kind === 'success'
					? 'success'
					: 'info'}
			data-testid="insert-result"
			role={result.kind === 'error' ? 'alert' : 'status'}
		>
			<Alert.Title>{result.message}</Alert.Title>
			{#if result.warnings.length > 0}
				<Alert.Description>
					<ul class="list-disc ps-5">
						{#each result.warnings as w (w)}<li>{w}</li>{/each}
					</ul>
				</Alert.Description>
			{/if}
			{#if result.statements.length > 0}
				<Alert.Description>
					<Collapsible.Root open={result.kind !== 'success'}>
						<Collapsible.Trigger>
							{#snippet child({ props })}
								<Button {...props} variant="link" size="sm" class="h-auto p-0"
									>{t('SQL query')}</Button
								>
							{/snippet}
						</Collapsible.Trigger>
						<Collapsible.Content>
							<pre
								class="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-foreground"
								data-testid="insert-sql">{result.statements.join(';\n')};</pre>
						</Collapsible.Content>
					</Collapsible.Root>
				</Alert.Description>
			{/if}
		</Alert.Root>
	{/if}

	{#if data.rows.length > 0 || data.mode === 'insert'}
		{#key data.revision}
			<InsertForm
				columns={data.columns}
				rows={data.rows}
				mode={data.mode}
				after={data.after}
				gotoUrl={data.goto}
				settings={data.settings}
				bind:result
			/>
		{/key}
	{/if}
</div>
