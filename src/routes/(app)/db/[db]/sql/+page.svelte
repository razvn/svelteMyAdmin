<script lang="ts">
	import SqlPage from '#lib/components/sql/sql-page.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<SqlPage {data} {form} />
