<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Folder from '@lucide/svelte/icons/folder';
	import Plus from '@lucide/svelte/icons/plus';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import type { NavConfig } from '#lib/nav/config.ts';
	import { filterNames, groupDatabases } from '#lib/nav/grouping.ts';
	import { cn } from '#lib/utils.ts';
	import DbNode from './db-node.svelte';
	import type { NavState } from './nav-state.svelte.ts';

	const { t } = useI18n();

	interface Props {
		databases: string[];
		nav: NavConfig;
		navState: NavState;
		currentDb?: string;
		currentTable?: string;
	}

	let { databases, nav, navState, currentDb, currentTable }: Props = $props();

	let query = $state('');
	let openGroups = $state<Record<string, boolean>>({});
	let extra = $state(0);

	const limit = $derived(nav.firstLevelItems + extra);
	const filtered = $derived(filterNames(databases, query));
	const entries = $derived(
		groupDatabases(filtered, { enabled: nav.groupingEnabled, separator: nav.dbSeparator })
	);
	const showFilter = $derived(databases.length >= nav.dbFilterMinimum);
	const filtering = $derived(query.trim() !== '');

	// A single database is expanded automatically (NavigationTreeAutoexpandSingleDb).
	$effect(() => {
		if (nav.autoexpandSingleDb && nav.expansionEnabled && databases.length === 1) {
			void navState.expand(databases[0]);
		}
	});

	function groupOpen(prefix: string, members: string[]): boolean {
		return filtering || openGroups[prefix] === true || (!!currentDb && members.includes(currentDb));
	}
</script>

<Sidebar.Group class="gap-1 px-3 py-1">
	<Sidebar.GroupLabel class="px-3">
		{t('Databases')}
		<span
			class="ms-auto rounded-full bg-muted px-1.5 text-[11px] leading-5 font-medium tracking-normal text-muted-foreground normal-case tabular-nums"
			data-testid="db-count">{databases.length}</span
		>
	</Sidebar.GroupLabel>
	{#if showFilter}
		<Sidebar.Input
			placeholder={t('Filter databases')}
			aria-label={t('Filter databases')}
			bind:value={query}
			class="mb-1"
		/>
	{/if}
	<Sidebar.GroupContent>
		<Sidebar.Menu aria-label={t('Databases')}>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton>
					{#snippet child({ props })}
						<a {...props} href={resolve(bare('/server/databases'))}>
							<Plus />
							<span>{t('New database')}</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>

			{#each entries.slice(0, limit) as entry (entry.kind === 'db' ? `db:${entry.name}` : `group:${entry.prefix}`)}
				{#if entry.kind === 'db'}
					<DbNode name={entry.name} {nav} {navState} {currentDb} {currentTable} />
				{:else}
					{@const open = groupOpen(
						entry.prefix,
						entry.children.map((c) => c.name)
					)}
					<Sidebar.MenuItem data-testid="nav-dbgroup-{entry.prefix}">
						<button
							type="button"
							class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm outline-hidden hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
							aria-expanded={open}
							onclick={() => (openGroups[entry.prefix] = !open)}
						>
							<ChevronRight
								class={cn(
									'size-4 shrink-0 text-sidebar-foreground/70 transition-transform',
									open && 'rotate-90'
								)}
							/>
							<Folder class="size-4 shrink-0" />
							<span class="truncate">{entry.prefix}</span>
							<span
								class="ms-auto rounded-full bg-muted px-1.5 text-[11px] leading-5 font-medium text-muted-foreground tabular-nums"
							>
								{entry.children.length}
							</span>
						</button>
						{#if open}
							<Sidebar.MenuSub>
								{#each entry.children as child (child.name)}
									<DbNode
										name={child.name}
										label={child.label}
										{nav}
										{navState}
										{currentDb}
										{currentTable}
									/>
								{/each}
							</Sidebar.MenuSub>
						{/if}
					</Sidebar.MenuItem>
				{/if}
			{/each}

			{#if entries.length > limit}
				<Sidebar.MenuItem>
					<button
						type="button"
						class="h-8 w-full rounded-md px-2 text-start text-xs text-muted-foreground outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-sidebar-ring"
						onclick={() => (extra += nav.maxItems)}
					>
						{t('Show more ({count} left)', { count: entries.length - limit })}
					</button>
				</Sidebar.MenuItem>
			{/if}

			{#if filtered.length === 0}
				<Sidebar.MenuItem>
					<span class="px-2 text-xs text-muted-foreground">{t('No databases')}</span>
				</Sidebar.MenuItem>
			{/if}
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>
