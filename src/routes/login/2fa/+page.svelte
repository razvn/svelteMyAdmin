<script lang="ts">
	import { enhance } from '$app/forms';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import BrandMark from '#lib/components/app-shell/brand-mark.svelte';
	import ThemeToggle from '#lib/components/theme-toggle.svelte';
	import ChallengeFields from '#lib/components/two-factor/challenge-fields.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const view = $derived(form?.view ?? data.view);
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Two-factor authentication - svelteMyAdmin</title>
</svelte:head>

<main class="grid min-h-screen place-items-center bg-background p-6 text-foreground">
	<div class="absolute end-4 top-4"><ThemeToggle /></div>
	<div class="flex w-full max-w-md flex-col items-center gap-8">
		<div class="flex items-center gap-3">
			<BrandMark />
			<span class="text-xl font-semibold tracking-tight">svelteMyAdmin</span>
		</div>
		<Card.Root class="w-full">
			<Card.Header>
				<Card.Title>
					<h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight">
						<ShieldCheck class="size-6" /> Two-factor authentication
					</h1>
				</Card.Title>
				<Card.Description>
					You have enabled two factor authentication, please confirm your login as
					<strong>{data.user}</strong>.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					class="grid gap-4"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							await update({ reset: true });
							submitting = false;
						};
					}}
				>
					{#if form?.error}
						<Alert.Root variant="destructive" data-testid="2fa-error">
							<CircleAlert />
							<Alert.Description>{form.error}</Alert.Description>
						</Alert.Root>
					{/if}
					<input type="hidden" name="redirect" value={data.redirectTo} />
					<ChallengeFields {view} idPrefix="login-2fa" />
					{#if view.backend !== 'WebAuthn' && view.backend !== 'invalid'}
						<Button type="submit" disabled={submitting} class="w-full">Verify</Button>
					{/if}
				</form>
				<form method="POST" action="/logout" class="mt-4 text-center">
					<Button type="submit" variant="link" size="sm">Cancel and log out</Button>
				</form>
			</Card.Content>
		</Card.Root>
	</div>
</main>
