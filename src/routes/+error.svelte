<script lang="ts">
	import { page } from '$app/state';
	import ErrorCard from '#lib/components/app-shell/error-card.svelte';
</script>

<main class="flex min-h-screen items-center justify-center bg-background text-foreground">
	<ErrorCard status={page.status} message={page.error?.message ?? 'Something went wrong.'} />
</main>
