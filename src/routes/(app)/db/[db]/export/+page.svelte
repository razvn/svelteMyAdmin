<script lang="ts">
	import ExportPage from '#lib/components/export/export-page.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#key data.action + data.sqlQuery + data.selectedRows.length}
	<ExportPage {data} />
{/key}
