<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import Construction from '@lucide/svelte/icons/construction';
	import PageHeader from './page-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { phaseTitle } from '#lib/nav/tabs.ts';

	const { t } = useI18n();

	interface Props {
		title: string;
		/** Roadmap phase that implements this page. */
		phase: number;
	}

	let { title, phase }: Props = $props();
</script>

<svelte:head>
	<title>{t(title)} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader title={t(title)} />

	<Card.Root data-testid="not-implemented">
		<Card.Content class="flex flex-col items-center gap-4 py-10 text-center">
			<span
				aria-hidden="true"
				class="flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary"
			>
				<Construction class="size-8" />
			</span>
			<div class="grid gap-1">
				<h2 class="text-lg font-semibold">{t('Coming soon')}</h2>
				<p class="max-w-md text-sm text-muted-foreground">
					{t('This page is not implemented yet. It is on the way and will show up here.')}
				</p>
			</div>
			<p class="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
				{t('Planned in')}
				<Badge variant="primary">{t(phaseTitle(phase))}</Badge>
				{t('(see docs/ROADMAP.md).')}
			</p>
		</Card.Content>
	</Card.Root>
</div>
