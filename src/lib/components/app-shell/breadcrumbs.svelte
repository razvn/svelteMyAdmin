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

	const tableKind = $derived(tableType === 'view' ? 'View' : 'Table');
</script>

{#snippet crumb(kind: string, name: string)}
	<span class="hidden text-muted-foreground sm:inline">{kind}:</span>
	<span class="font-medium">{name}</span>
{/snippet}

<Breadcrumb.Root>
	<Breadcrumb.List class="flex-nowrap">
		<Breadcrumb.Item>
			<Breadcrumb.Link href={serverHref(nav)} aria-current={db ? undefined : 'page'}>
				{@render crumb('Server', serverLabel)}
			</Breadcrumb.Link>
		</Breadcrumb.Item>
		{#if db}
			<Breadcrumb.Separator><ChevronRight /></Breadcrumb.Separator>
			<Breadcrumb.Item>
				<Breadcrumb.Link href={dbHref(nav, db)} aria-current={table ? undefined : 'page'}>
					{@render crumb('Database', db)}
				</Breadcrumb.Link>
			</Breadcrumb.Item>
		{/if}
		{#if db && table}
			<Breadcrumb.Separator><ChevronRight /></Breadcrumb.Separator>
			<Breadcrumb.Item>
				<Breadcrumb.Link href={tableHref(nav, db, table)} aria-current="page">
					{@render crumb(tableKind, table)}
				</Breadcrumb.Link>
			</Breadcrumb.Item>
		{/if}
	</Breadcrumb.List>
</Breadcrumb.Root>
