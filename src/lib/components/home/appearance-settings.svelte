<script lang="ts">
	import { resetMode, setMode, userPrefersMode } from 'mode-watcher';
	import LanguageSelect from '#lib/components/i18n/language-select.svelte';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';

	const { t } = useI18n();

	const themes = $derived([
		{ value: 'light', label: t('Light') },
		{ value: 'dark', label: t('Dark') },
		{ value: 'system', label: t('System') }
	]);

	const theme = $derived(userPrefersMode.current);
	const themeLabel = $derived(themes.find((x) => x.value === theme)?.label ?? t('System'));

	function onTheme(value: string) {
		if (value === 'system') resetMode();
		else setMode(value === 'dark' ? 'dark' : 'light');
	}
</script>

<div class="grid gap-4">
	<div class="grid gap-2">
		<Label for="theme-select">{t('Theme')}</Label>
		<Select.Root type="single" value={theme} onValueChange={onTheme}>
			<Select.Trigger id="theme-select" class="w-full" data-testid="theme-select">
				{themeLabel}
			</Select.Trigger>
			<Select.Content>
				{#each themes as x (x.value)}
					<Select.Item value={x.value} label={x.label}>{x.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	<div class="grid gap-2">
		<Label for="language-select">{t('Language')}</Label>
		<LanguageSelect id="language-select" />
	</div>
</div>
