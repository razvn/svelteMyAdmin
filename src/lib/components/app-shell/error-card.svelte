<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';

	interface Props {
		status: number;
		message: string;
	}

	let { status, message }: Props = $props();

	const title = $derived(
		status === 404
			? 'Not found'
			: status === 403
				? 'Forbidden'
				: status >= 500
					? 'Server error'
					: 'Error'
	);
</script>

<svelte:head>
	<title>{status} {title} - svelteMyAdmin</title>
</svelte:head>

<div class="flex min-h-[40vh] items-center justify-center p-4">
	<Card.Root class="w-full max-w-md" data-testid="error-card">
		<Card.Content class="grid justify-items-center gap-5 text-center">
			<span
				aria-hidden="true"
				class="flex size-16 items-center justify-center rounded-2xl bg-destructive-soft text-destructive"
			>
				<CircleAlert class="size-8" />
			</span>
			<h1 class="text-2xl font-semibold tracking-tight">{status} {title}</h1>
			<Alert.Root variant="destructive" class="text-start">
				<Alert.Description>{message}</Alert.Description>
			</Alert.Root>
			<a href={resolve(bare('/'))} class={buttonVariants({ variant: 'default' })}>Back to home</a>
		</Card.Content>
	</Card.Root>
</div>
