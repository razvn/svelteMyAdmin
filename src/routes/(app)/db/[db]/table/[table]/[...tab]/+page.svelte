<script lang="ts">
	import NotImplemented from '#lib/components/app-shell/not-implemented.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<NotImplemented title={data.tab.label} phase={data.tab.phase} />
