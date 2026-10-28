<script lang="ts">
	import { resetMode, setMode, userPrefersMode } from 'mode-watcher';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';

	const themes = [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'system', label: 'System' }
	];
	const languages = [{ value: 'en', label: 'English' }];

	const theme = $derived(userPrefersMode.current);
	const themeLabel = $derived(themes.find((t) => t.value === theme)?.label ?? 'System');

	function onTheme(value: string) {
		if (value === 'system') resetMode();
		else setMode(value === 'dark' ? 'dark' : 'light');
	}
</script>

<div class="grid gap-4">
	<div class="grid gap-2">
		<Label for="theme-select">Theme</Label>
		<Select.Root type="single" value={theme} onValueChange={onTheme}>
			<Select.Trigger id="theme-select" class="w-full" data-testid="theme-select">
				{themeLabel}
			</Select.Trigger>
			<Select.Content>
				{#each themes as t (t.value)}
					<Select.Item value={t.value} label={t.label}>{t.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	<div class="grid gap-2">
		<Label for="language-select">Language</Label>
		<Select.Root type="single" value="en">
			<Select.Trigger id="language-select" class="w-full">English</Select.Trigger>
			<Select.Content>
				{#each languages as l (l.value)}
					<Select.Item value={l.value} label={l.label}>{l.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
</div>
