<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import { page } from '$app/state';
	import { truncate } from '#lib/format.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';

	const { t, fmt } = useI18n();
	const formatBytes = fmt.bytes;
	let { data }: PageProps = $props();

	const SHORT = 100;

	/** Same page with some query parameters replaced. */
	function go(changes: Record<string, string | null>) {
		const url = new URL(page.url.href);
		for (const [k, v] of Object.entries(changes)) {
			if (v === null) url.searchParams.delete(k);
			else url.searchParams.set(k, v);
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved path plus query string
		return goto(`${resolve(bare('/server/binlog'))}${url.search}`, { reset: false });
	}

	const file = $derived(data.file ?? '');
	const fileSize = $derived(data.files.find((f) => f.name === data.file)?.size ?? 0);
	const from = $derived(data.offset + 1);
	const to = $derived(data.offset + data.events.length);
</script>

<svelte:head>
	<title>{t('Binary log')} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={ScrollText}
		title={t('Binary log')}
		description={t('Browse the events recorded in the server binary logs.')}
	/>

	<Card.Root class="gap-0 py-0">
		<div class="flex flex-wrap items-center gap-4 border-b p-5">
			<Select.Root type="single" value={file} onValueChange={(v) => go({ file: v, offset: null })}>
				<Select.Trigger class="w-72" aria-label={t('Binary log file')} data-testid="binlog-file">
					{file ? `${file} (${formatBytes(fileSize)})` : t('No binary logs')}
				</Select.Trigger>
				<Select.Content>
					{#each data.files as f (f.name)}
						<Select.Item value={f.name} label={f.name}>{f.name} ({formatBytes(f.size)})</Select.Item
						>
					{/each}
				</Select.Content>
			</Select.Root>
			<Button variant="outline" size="sm" onclick={() => go({ full: data.full ? null : '1' })}>
				{data.full ? t('Truncate shown queries') : t('Show full queries')}
			</Button>
			<div class="ms-auto flex items-center gap-2 text-sm">
				{#if data.events.length > 0}
					<span data-testid="binlog-range">{t('Events {from} - {to}', { from, to })}</span>
				{/if}
				<Button
					variant="outline"
					size="sm"
					disabled={data.offset === 0}
					onclick={() => go({ offset: String(Math.max(0, data.offset - data.pageSize)) })}
				>
					{t('Previous')}
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={!data.hasMore}
					onclick={() => go({ offset: String(data.offset + data.pageSize) })}
				>
					{t('Next')}
				</Button>
			</div>
		</div>

		<Table.Root data-testid="binlog-table">
			<Table.Header>
				<Table.Row>
					<Table.Head>{t('Log name')}</Table.Head>
					<Table.Head class="text-end">{t('Position')}</Table.Head>
					<Table.Head>{t('Event type')}</Table.Head>
					<Table.Head class="text-end">{t('Server ID')}</Table.Head>
					<Table.Head class="text-end">{t('Original position')}</Table.Head>
					<Table.Head>{t('Information')}</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.events as e (e.pos)}
					<Table.Row>
						<Table.Cell>{e.logName}</Table.Cell>
						<Table.Cell class="text-end tabular-nums">{e.pos}</Table.Cell>
						<Table.Cell><Badge variant="info">{e.eventType}</Badge></Table.Cell>
						<Table.Cell class="text-end tabular-nums">{e.serverId}</Table.Cell>
						<Table.Cell class="text-end tabular-nums">{e.endLogPos}</Table.Cell>
						<Table.Cell class="max-w-xl font-mono text-xs break-all whitespace-pre-wrap">
							{data.full ? e.info : truncate(e.info, SHORT)}
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={6} class="text-center text-muted-foreground">{t('No events.')}</Table.Cell
						>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</Card.Root>
</div>
