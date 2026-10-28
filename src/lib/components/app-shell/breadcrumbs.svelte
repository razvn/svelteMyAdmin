<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.ts';
	import { dbHref, serverHref, tableHref, type NavConfig } from '#lib/nav/config.ts';

	interface Props {
		nav: Pick<NavConfig, 'defaultTabServer' | 'defaultTabDatabase' | 'defaultTabTable'>;
		/** Verbose name or host[:port] of the server. */
		serverLabel: string;
		db?: string;
		table?: string;
		tableType?: 'table' | 'view';
	}

	let { nav, serverLabel, db, table, tableType = 'table' }: Props = $props();

	// Never wrap: every crumb ellipsizes, the server label first, then the database, then the table.
	const ITEM = 'min-w-12 [&:first-child]:min-w-8';
	const LINK = 'block max-w-full truncate';

	const tableKind = $derived(tableType === 'view' ? 'View' : 'Table');
</script>

{#snippet crumb(kind: string, name: string)}
	<span class="hidden text-muted-foreground lg:inline">{kind}:</span>
	<span class="font-medium">{name}</span>
{/snippet}

<Breadcrumb.Root class="w-full min-w-0">
	<Breadcrumb.List class="w-full flex-nowrap gap-1.5 sm:gap-1.5">
		<Breadcrumb.Item class="{ITEM} shrink-[4]">
			<Breadcrumb.Link href={serverHref(nav)} class={LINK} aria-current={db ? undefined : 'page'}>
				{@render crumb('Server', serverLabel)}
			</Breadcrumb.Link>
		</Breadcrumb.Item>
		{#if db}
			<Breadcrumb.Separator class="shrink-0"><ChevronRight /></Breadcrumb.Separator>
			<Breadcrumb.Item class="{ITEM} shrink-[2]">
				<Breadcrumb.Link
					href={dbHref(nav, db)}
					class={LINK}
					aria-current={table ? undefined : 'page'}
				>
					{@render crumb('Database', db)}
				</Breadcrumb.Link>
			</Breadcrumb.Item>
		{/if}
		{#if db && table}
			<Breadcrumb.Separator class="shrink-0"><ChevronRight /></Breadcrumb.Separator>
			<Breadcrumb.Item class="{ITEM} shrink">
				<Breadcrumb.Link href={tableHref(nav, db, table)} class={LINK} aria-current="page">
					{@render crumb(tableKind, table)}
				</Breadcrumb.Link>
			</Breadcrumb.Item>
		{/if}
	</Breadcrumb.List>
</Breadcrumb.Root>
