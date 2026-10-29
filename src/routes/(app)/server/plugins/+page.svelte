<script lang="ts">
	import PlugZap from '@lucide/svelte/icons/plug-zap';
	import Search from '@lucide/svelte/icons/search';
	import { matchesFilter } from '#lib/admin/filter.ts';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { pluginStatusVariant } from '#lib/admin/badges.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t } = useI18n();
	let { data }: PageProps = $props();

	let filter = $state('');

	const groups = $derived(
		data.groups
			.map((group) => ({
				...group,
				plugins: group.plugins.filter((p) =>
					matchesFilter(filter, p.name, p.description, p.author, p.license)
				)
			}))
			.filter((group) => group.plugins.length > 0)
	);
	const total = $derived(data.groups.reduce((n, g) => n + g.plugins.length, 0));
	const shown = $derived(groups.reduce((n, g) => n + g.plugins.length, 0));
</script>

<svelte:head>
	<title>{t('Plugins')} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={PlugZap}
		title={t('Plugins')}
		description={t('Server plugins grouped by type, with their status and licence.')}
	/>

	<Card.Root>
		<Card.Content class="grid gap-4">
			<div class="flex flex-wrap items-center gap-4">
				<div class="relative max-w-sm flex-1">
					<Search
						class="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						type="search"
						class="ps-8"
						placeholder={t('Filter by name, description, author or license')}
						aria-label={t('Filter plugins')}
						data-testid="plugins-filter"
						bind:value={filter}
					/>
				</div>
				<span class="text-sm text-muted-foreground" data-testid="plugins-count">
					{t('{shown} of {total} plugins shown', { shown, total })}
				</span>
			</div>
			<nav class="flex flex-wrap gap-2">
				{#each data.groups as group (group.type)}
					<a
						class="rounded-full border bg-card px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary-soft hover:text-primary"
						href={`#${group.anchor}`}>{group.type}</a
					>
				{/each}
			</nav>
		</Card.Content>
	</Card.Root>

	{#each groups as group (group.type)}
		<Card.Root
			id={group.anchor}
			class="scroll-mt-28 gap-0 py-0"
			data-testid="plugin-group"
			data-type={group.type}
		>
			<Card.Header class="border-b py-5">
				<Card.Title>{group.type}</Card.Title>
			</Card.Header>
			<Card.Content class="px-0">
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>{t('Plugin')}</Table.Head>
								<Table.Head>{t('Description')}</Table.Head>
								<Table.Head>{t('Version')}</Table.Head>
								<Table.Head>{t('Author')}</Table.Head>
								<Table.Head>{t('License')}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each group.plugins as plugin (plugin.name)}
								<Table.Row data-testid="plugin-row" data-plugin={plugin.name}>
									<Table.Cell class="font-medium">
										<span class="flex items-center gap-2">
											{plugin.name}
											<Badge variant={pluginStatusVariant(plugin.status)}>{plugin.status}</Badge>
										</span>
									</Table.Cell>
									<Table.Cell class="min-w-64 whitespace-normal text-muted-foreground">
										{plugin.description}
									</Table.Cell>
									<Table.Cell class="tabular-nums">{plugin.version}</Table.Cell>
									<Table.Cell class="whitespace-normal">{plugin.author}</Table.Cell>
									<Table.Cell>{plugin.license}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</Card.Content>
		</Card.Root>
	{:else}
		<p class="text-sm text-muted-foreground">{t('No plugins match the filter.')}</p>
	{/each}
</div>
