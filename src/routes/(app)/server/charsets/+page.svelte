<script lang="ts">
	import Languages from '@lucide/svelte/icons/languages';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t, tn } = useI18n();
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{t('Character sets')} - svelteMyAdmin</title>
</svelte:head>

<PageHeader
	icon={Languages}
	title={t('Character sets and collations')}
	description={tn(
		'{n} character set supported by this server.',
		'{n} character sets supported by this server.',
		data.charsets.length
	)}
/>

<div class="grid gap-6 xl:grid-cols-2" data-testid="charsets">
	{#each data.charsets as charset (charset.name)}
		<Card.Root class="gap-0 py-0" data-testid="charset" data-charset={charset.name}>
			<Card.Header class="border-b py-5">
				<Card.Title class="font-mono">{charset.name}</Card.Title>
				<Card.Description>{charset.description}</Card.Description>
			</Card.Header>
			<Card.Content class="px-0">
				<ul class="divide-y">
					{#each charset.collations as collation (collation.name)}
						<li
							class="flex flex-wrap items-center justify-between gap-2 px-6 py-3 transition-colors hover:bg-muted/60 {collation.isServerDefault
								? 'bg-primary-soft'
								: ''}"
							data-testid="collation"
							data-collation={collation.name}
						>
							<span class="font-mono text-sm">{collation.name}</span>
							<span class="flex gap-1">
								{#if collation.isServerDefault}
									<Badge variant="primary" data-testid="server-default">{t('server default')}</Badge>
								{/if}
								{#if collation.isDefault}
									<Badge variant="muted">{t('default')}</Badge>
								{/if}
							</span>
						</li>
					{:else}
						<li class="px-6 py-3 text-sm text-muted-foreground">{t('No collations.')}</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	{:else}
		<p class="text-sm text-muted-foreground">{t('No character sets found.')}</p>
	{/each}
</div>
