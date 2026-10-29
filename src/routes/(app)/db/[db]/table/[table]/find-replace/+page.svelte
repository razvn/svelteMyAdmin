<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Replace from '@lucide/svelte/icons/replace';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import NativeSelect from '#lib/components/table-search/native-select.svelte';
	import SearchNav from '#lib/components/table-search/search-nav.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t, tn } = useI18n();

	let { data, form }: PageProps = $props();

	const db = $derived(page.params.db ?? '');
	const table = $derived(page.params.table ?? '');
	let busy = $state(false);
	const preview = $derived(form && 'preview' in form ? form.preview : null);
	const replaced = $derived(form && 'replaced' in form ? form.replaced : null);
	const error = $derived(form && 'error' in form ? form.error : null);
</script>

<svelte:head>
	<title>{t('Find and replace')} - {table} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Replace}
		title={t('Find and replace')}
		description={t('Replace text in one column of {table}. Matching is case sensitive.', { table })}
	/>
	<SearchNav {db} {table} current="find-replace" />

	<form
		method="POST"
		action="?/preview"
		data-testid="find-replace-form"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
	>
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Find and replace')}</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{#if data.columns.length === 0}
					<Alert><AlertDescription>{t('This table has no text columns.')}</AlertDescription></Alert>
				{/if}
				<div class="flex flex-col gap-2">
					<Label for="fr-find">{t('Find:')}</Label>
					<Input
						id="fr-find"
						name="find"
						required
						autocomplete="off"
						value={form?.values?.find ?? ''}
						class="max-w-xl"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="fr-replace">{t('Replace with:')}</Label>
					<Input
						id="fr-replace"
						name="replaceWith"
						autocomplete="off"
						value={form?.values?.replaceWith ?? ''}
						class="max-w-xl"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="fr-column">{t('Column:')}</Label>
					<NativeSelect
						id="fr-column"
						name="column"
						class="max-w-xs"
						value={form?.values?.column ?? data.columns[0]?.name}
					>
						{#each data.columns as c (c.name)}
							<option value={c.name}>{c.name}</option>
						{/each}
					</NativeSelect>
				</div>
				<div class="flex items-center gap-2">
					<Checkbox id="fr-regex" name="useRegex" checked={form?.values?.useRegex ?? false} />
					<Label for="fr-regex" class="font-normal">{t('Use regular expression')}</Label>
				</div>
				<p class="text-xs text-muted-foreground">
					{t(
						'Regular expressions use REGEXP_REPLACE: MySQL (ICU) references groups as $1, MariaDB (PCRE) as \\1.'
					)}
				</p>
			</Card.Content>
			<Card.Footer class="flex gap-2">
				<Button type="submit" variant="secondary" disabled={busy || data.columns.length === 0}>
					{t('Preview')}
				</Button>
				<Button
					type="submit"
					formaction="?/replace"
					disabled={busy || data.columns.length === 0}
					data-testid="replace-button"
				>
					{t('Replace')}
				</Button>
			</Card.Footer>
		</Card.Root>
	</form>

	{#if error}
		<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
	{/if}

	{#if replaced}
		<Alert data-testid="replace-result">
			<AlertDescription>
				{t('Your SQL query has been executed successfully.')}
				{tn('{n} row affected.', '{n} rows affected.', replaced.affected)}
			</AlertDescription>
		</Alert>
	{/if}

	{#if preview}
		<Card.Root data-testid="replace-preview">
			<Card.Header>
				<Card.Title>{t('Find and replace - preview')}</Card.Title>
				<Card.Description>
					{tn('{n} row would be changed.', '{n} rows would be changed.', preview.rows)}
					{#if preview.truncated}{t('Showing the first {n} distinct values.', {
							n: preview.samples.length
						})}{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="text-end">{t('Count')}</Table.Head>
							<Table.Head>{t('Original string')}</Table.Head>
							<Table.Head>{t('Replaced string')}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each preview.samples as s (s.original)}
							<Table.Row>
								<Table.Cell class="text-end">{s.count}</Table.Cell>
								<Table.Cell class="font-mono">{s.original}</Table.Cell>
								<Table.Cell class="font-mono">{s.replaced}</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={3} class="text-muted-foreground">{t('No matches.')}</Table.Cell
								>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
