<script lang="ts">
	import { page } from '$app/state';
	import TriggersView from '#lib/components/database/triggers-view.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Triggers - {page.params.table} - svelteMyAdmin</title>
</svelte:head>

<TriggersView triggers={data.triggers} tables={data.tables} fixedTable={data.fixedTable} />
