<script lang="ts">
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
</script>

<svelte:head>
	<title>Two-factor authentication - Settings - svelteMyAdmin</title>
</svelte:head>

<Alert data-testid="two-factor-placeholder">
	<AlertTitle>Two-factor authentication</AlertTitle>
	<AlertDescription>
		Two-factor authentication is not available yet. It is planned for Phase 9 (see docs/ROADMAP.md).
	</AlertDescription>
</Alert>
