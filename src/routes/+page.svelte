<script lang="ts">
	import LogOut from '@lucide/svelte/icons/log-out';
	import ThemeToggle from '#lib/components/theme-toggle.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>svelteMyAdmin</title>
</svelte:head>

<main class="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
	<Card.Root class="w-full max-w-md">
		<Card.Header>
			<Card.Title>
				<h1 class="text-3xl font-semibold tracking-tight">svelteMyAdmin</h1>
			</Card.Title>
			<Card.Description>A SvelteKit re-implementation of phpMyAdmin.</Card.Description>
			<Card.Action>
				<ThemeToggle />
			</Card.Action>
		</Card.Header>
		<Card.Content class="grid gap-4">
			<p class="text-sm text-muted-foreground" data-testid="connection-info">
				Connected as <span class="font-medium text-foreground">{data.user}@{data.host}</span>
			</p>
			<form method="POST" action="/logout">
				<Button type="submit" variant="outline">
					<LogOut />
					Log out
				</Button>
			</form>
		</Card.Content>
	</Card.Root>
</main>
