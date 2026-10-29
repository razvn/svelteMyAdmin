<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { formatEnumValues, parseEnumValues } from '#lib/sql/column-definition.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		open: boolean;
		/** Current value of the Length/Values field (`'a','b'`). */
		value: string;
		type: string;
		onapply: (value: string) => void;
	}

	let { open = $bindable(), value, type, onapply }: Props = $props();

	let items = $state<{ key: number; text: string }[]>([]);
	let seq = 0;

	// Load the current values each time the dialog opens.
	$effect(() => {
		if (open) {
			const parsed = parseEnumValues(value);
			items = (parsed.length ? parsed : ['']).map((text) => ({ key: seq++, text }));
		}
	});

	function apply() {
		onapply(formatEnumValues(items.map((i) => i.text).filter((tbl) => tbl !== '')));
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>{t('Values for the column')}</Dialog.Title>
			<Dialog.Description>
				{t('Create the list of {type} values. Quotes and backslashes are escaped for you.', {
					type
				})}
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex max-h-80 flex-col gap-2 overflow-y-auto pe-1">
			{#each items as item, i (item.key)}
				<div class="flex items-center gap-2">
					<Input
						bind:value={item.text}
						aria-label={t('Value {n}', { n: i + 1 })}
						autocomplete="off"
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={t('Remove value {n}', { n: i + 1 })}
						onclick={() => (items = items.filter((x) => x.key !== item.key))}
					>
						<X />
					</Button>
				</div>
			{/each}
		</div>
		<div class="text-sm text-muted-foreground">
			{t('Result:')}
			<code class="font-mono text-foreground">
				{formatEnumValues(items.map((i) => i.text).filter((tbl) => tbl !== ''))}
			</code>
		</div>
		<Dialog.Footer class="sm:justify-between">
			<Button
				type="button"
				variant="outline"
				onclick={() => (items = [...items, { key: seq++, text: '' }])}
			>
				<Plus />
				{t('Add a value')}
			</Button>
			<div class="flex gap-2">
				<Button type="button" variant="ghost" onclick={() => (open = false)}>{t('Cancel')}</Button>
				<Button type="button" onclick={apply}>{t('Go')}</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
