<script lang="ts">
	import { page } from '$app/state';
	import ErrorCard from '#lib/components/app-shell/error-card.svelte';
</script>

<ErrorCard status={page.status} message={page.error?.message ?? 'Something went wrong.'} />
