<script lang="ts">
	import AccessList from '#lib/components/privileges/access-list.svelte';
	import type { PageProps } from './$types';

	let { data, params }: PageProps = $props();
</script>

<svelte:head>
	<title>Privileges - {params.db}.{params.table} - svelteMyAdmin</title>
</svelte:head>

<AccessList
	title="Users having access to “{params.db}.{params.table}”"
	db={params.db}
	state={data.state}
	isGrantUser={data.isGrantUser}
	rows={data.state === 'ok' ? data.rows : []}
/>
