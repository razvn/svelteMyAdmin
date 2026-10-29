<script lang="ts">
	// i18n-ignore-file
	// Test harness: provides an I18n whose source can be swapped at runtime, like the root layout does
	// after `refreshAll()`.
	import { I18n, setI18n, type Catalog } from '#lib/i18n/index.ts';
	import AppearanceSettings from '#lib/components/home/appearance-settings.svelte';

	interface Props {
		catalogs: Record<string, Catalog>;
	}
	let { catalogs }: Props = $props();

	let locale = $state('en');
	const i18n = new I18n(() => ({ locale, catalog: catalogs[locale] ?? {} }));
	setI18n(i18n);
	const { t, tn } = i18n;
</script>

<p data-testid="greeting">{t('Log in')}</p>
<p data-testid="count">{tn('{n} row', '{n} rows', 1)} / {tn('{n} row', '{n} rows', 0)}</p>
<button type="button" onclick={() => (locale = 'fr')}>to-fr</button>
<button type="button" onclick={() => (locale = 'es')}>to-es</button>
<button type="button" onclick={() => (locale = 'en')}>to-en</button>
<AppearanceSettings />
