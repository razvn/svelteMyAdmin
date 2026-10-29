<script lang="ts">
	import { page } from '$app/state';
	import TriggersView from '#lib/components/database/triggers-view.svelte';
	import type { PageProps } from './$types';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{t('Triggers')} - {page.params.db} - svelteMyAdmin</title>
</svelte:head>

<TriggersView triggers={data.triggers} tables={data.tables} fixedTable={data.fixedTable} />
