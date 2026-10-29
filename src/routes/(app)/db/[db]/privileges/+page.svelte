<script lang="ts">
	import AccessList from '#lib/components/privileges/access-list.svelte';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t } = useI18n();
	let { data, params }: PageProps = $props();
</script>

<svelte:head>
	<title>{t('Privileges')} - {params.db} - svelteMyAdmin</title>
</svelte:head>

<AccessList
	title={t('Users having access to “{db}”', { db: params.db })}
	db={params.db}
	state={data.state}
	isGrantUser={data.isGrantUser}
	rows={data.state === 'ok' ? data.rows : []}
/>
