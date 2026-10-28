<script lang="ts">
	import PlugZap from '@lucide/svelte/icons/plug-zap';
	import Search from '@lucide/svelte/icons/search';
	import { matchesFilter } from '#lib/admin/filter.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { pluginStatusVariant } from '#lib/admin/badges.ts';
	import type { PageProps } from './$types';

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
	<title>Plugins - svelteMyAdmin</title>
</svelte:head>

<h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight">
	<PlugZap class="size-5 text-muted-foreground" />
	Plugins
</h1>

<Card.Root>
	<Card.Content class="grid gap-4">
		<div class="flex flex-wrap items-center gap-4">
			<div class="relative max-w-sm flex-1">
				<Search class="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					class="ps-8"
					placeholder="Filter by name, description, author or license"
					aria-label="Filter plugins"
					data-testid="plugins-filter"
					bind:value={filter}
				/>
			</div>
			<span class="text-sm text-muted-foreground" data-testid="plugins-count">
				{shown} of {total} plugins shown
			</span>
		</div>
		<nav class="flex flex-wrap gap-2">
			{#each data.groups as group (group.type)}
				<a class="rounded-md border px-2 py-1 text-sm hover:bg-muted" href={`#${group.anchor}`}
					>{group.type}</a
				>
			{/each}
		</nav>
	</Card.Content>
</Card.Root>

{#each groups as group (group.type)}
	<Card.Root id={group.anchor} data-testid="plugin-group" data-type={group.type}>
		<Card.Header>
			<Card.Title>{group.type}</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Plugin</Table.Head>
							<Table.Head>Description</Table.Head>
							<Table.Head>Version</Table.Head>
							<Table.Head>Author</Table.Head>
							<Table.Head>License</Table.Head>
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
								<Table.Cell class="whitespace-normal">{plugin.description}</Table.Cell>
								<Table.Cell>{plugin.version}</Table.Cell>
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
	<p class="text-sm text-muted-foreground">No plugins match the filter.</p>
{/each}
