<script lang="ts">
	import ImportPage from '#lib/components/import/import-page.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<ImportPage {data} />
