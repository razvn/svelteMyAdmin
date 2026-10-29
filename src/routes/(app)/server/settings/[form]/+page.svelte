<script lang="ts">
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import PrefsForm from '#lib/components/preferences/prefs-form.svelte';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t } = useI18n();
	let { data, form }: PageProps = $props();

	// Re-create the form state whenever the saved values change (after Apply or a reset elsewhere).
	const fingerprint = $derived(
		data.form.sections.flatMap((s) => s.fields.map((f) => `${f.path}=${f.value}`)).join('\n') +
			(form?.values ? '#rejected' : '')
	);
</script>

<svelte:head>
	<title>{t(data.form.title)} - {t('Settings')} - svelteMyAdmin</title>
</svelte:head>

{#if data.saved}
	<Alert variant="success" role="status" data-testid="settings-saved" class="mb-6">
		<AlertDescription>{t('Configuration has been saved.')}</AlertDescription>
	</Alert>
{/if}
{#if data.storage.unavailable}
	<Alert variant="warning" role="status" class="mb-6">
		<AlertTitle>{t('Configuration storage unavailable')}</AlertTitle>
		<AlertDescription>
			{t('The user preferences table could not be read; settings are kept in a browser cookie.')}
		</AlertDescription>
	</Alert>
{/if}

{#key fingerprint}
	<PrefsForm
		view={data.form}
		posted={form?.values ?? null}
		errors={form?.errors ?? null}
		message={form?.message ?? null}
	/>
{/key}
