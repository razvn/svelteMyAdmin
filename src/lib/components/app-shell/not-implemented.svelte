<script lang="ts">
	import Construction from '@lucide/svelte/icons/construction';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { phaseTitle } from '#lib/nav/tabs.ts';

	interface Props {
		title: string;
		/** Roadmap phase that implements this page. */
		phase: number;
	}

	let { title, phase }: Props = $props();
</script>

<svelte:head>
	<title>{title} - svelteMyAdmin</title>
</svelte:head>

<Card.Root class="max-w-xl" data-testid="not-implemented">
	<Card.Header>
		<Card.Title>
			<h1 class="flex items-center gap-2 text-xl font-semibold">
				<Construction class="size-5 text-muted-foreground" />
				{title}
			</h1>
		</Card.Title>
		<Card.Description>This page is not implemented yet.</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
		Planned in
		<Badge variant="secondary">{phaseTitle(phase)}</Badge>
		(see docs/ROADMAP.md).
	</Card.Content>
</Card.Root>
