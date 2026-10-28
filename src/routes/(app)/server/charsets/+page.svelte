<script lang="ts">
	import Languages from '@lucide/svelte/icons/languages';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Character sets - svelteMyAdmin</title>
</svelte:head>

<h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight">
	<Languages class="size-5 text-muted-foreground" />
	Character sets and collations
</h1>

<div class="grid gap-4" data-testid="charsets">
	{#each data.charsets as charset (charset.name)}
		<Card.Root data-testid="charset" data-charset={charset.name}>
			<Card.Header>
				<Card.Title class="font-mono">{charset.name}</Card.Title>
				<Card.Description>{charset.description}</Card.Description>
			</Card.Header>
			<Card.Content>
				<ul class="divide-y">
					{#each charset.collations as collation (collation.name)}
						<li
							class="flex flex-wrap items-center justify-between gap-2 py-2 {collation.isServerDefault
								? 'bg-muted'
								: ''}"
							data-testid="collation"
							data-collation={collation.name}
						>
							<span class="font-mono text-sm">{collation.name}</span>
							<span class="flex gap-1">
								{#if collation.isServerDefault}
									<Badge data-testid="server-default">server default</Badge>
								{/if}
								{#if collation.isDefault}
									<Badge variant="secondary">default</Badge>
								{/if}
							</span>
						</li>
					{:else}
						<li class="py-2 text-sm text-muted-foreground">No collations.</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	{:else}
		<p class="text-sm text-muted-foreground">No character sets found.</p>
	{/each}
</div>
