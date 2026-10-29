<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';
	import { languageLabel, useI18n } from '#lib/i18n/index.ts';
	import { setLanguage } from '#lib/i18n/switch.ts';

	interface Props {
		id: string;
		/** Form field name; adds a hidden input so a surrounding form submits the language. */
		name?: string;
		onerror?: () => void;
	}

	let { id, name, onerror }: Props = $props();

	const i18n = useI18n();
	const label = $derived(languageLabel(i18n.language));

	async function change(code: string) {
		if (code === i18n.locale) return;
		if (!(await setLanguage(code))) onerror?.();
	}
</script>

<Select.Root type="single" {name} value={i18n.locale} onValueChange={change}>
	<Select.Trigger {id} class="w-full" data-testid="language-select">{label}</Select.Trigger>
	<Select.Content>
		{#each i18n.languages as l (l.code)}
			<Select.Item value={l.code} label={languageLabel(l)}>{languageLabel(l)}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
