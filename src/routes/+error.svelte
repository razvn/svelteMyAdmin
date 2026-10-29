<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { page } from '$app/state';
	import ErrorCard from '#lib/components/app-shell/error-card.svelte';

	const { t } = useI18n();
</script>

<main class="flex min-h-screen items-center justify-center bg-background text-foreground">
	<ErrorCard status={page.status} message={page.error?.message ?? t('Something went wrong.')} />
</main>
