<script lang="ts">
	import Wand from '@lucide/svelte/icons/wand-sparkles';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{t('Transformations')} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Wand}
		title={t('Transformations')}
		description={t(
			'Media types and the display and input transformations available for table columns.'
		)}
	/>

	<Card.Root>
		<Card.Header>
			<Card.Title>{t('Available media types')}</Card.Title>
		</Card.Header>
		<Card.Content>
			<ul class="flex flex-wrap gap-2" data-testid="mime-types">
				{#each data.mimeTypes as mime (mime)}
					<li><Badge variant="secondary">{mime}</Badge></li>
				{/each}
			</ul>
		</Card.Content>
	</Card.Root>

	{#each [{ id: 'transformation', title: t('Available browser display transformations'), head: t('Browser display transformation'), rows: data.transformations }, { id: 'input_transformation', title: t('Available input transformations'), head: t('Input transformation'), rows: data.inputTransformations }] as section (section.id)}
		<Card.Root id={section.id} class="gap-0 py-0">
			<Card.Header class="border-b py-5">
				<Card.Title>{section.title}</Card.Title>
			</Card.Header>
			<Table.Root data-testid="{section.id}-table">
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-64">{section.head}</Table.Head>
						<Table.Head>{t('Description')}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each section.rows as row (row.name)}
						<Table.Row>
							<Table.Cell class="align-top font-medium">
								{row.name}
								{#if row.unsupported}<Badge variant="warning" class="ms-2"
										>{t('not supported')}</Badge
									>{/if}
							</Table.Cell>
							<Table.Cell class="whitespace-normal text-muted-foreground"
								>{row.description}</Table.Cell
							>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Root>
	{/each}
</div>
