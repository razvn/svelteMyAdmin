<script lang="ts">
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Command from '#lib/components/ui/command/index.ts';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import type { ForeignOption } from '#lib/sql/insert-edit.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		name: string;
		options: ForeignOption[];
		value: string;
		disabled?: boolean;
		label: string;
	}

	let { name, options, value = $bindable(''), disabled = false, label }: Props = $props();

	let open = $state(false);
	const selected = $derived(options.find((o) => o.value === value));
</script>

<input type="hidden" {name} {value} {disabled} />
<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				role="combobox"
				aria-label={label}
				aria-expanded={open}
				{disabled}
				class="w-64 justify-between font-normal"
			>
				<span class="truncate">{selected?.label ?? (value === '' ? '' : value)}</span>
				<ChevronsUpDown class="size-4 shrink-0 opacity-50" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-72 p-0" align="start">
		<Command.Root>
			<Command.Input placeholder={t('Search referenced values')} />
			<Command.List>
				<Command.Empty>{t('No match.')}</Command.Empty>
				<Command.Group>
					<Command.Item
						value="(none)"
						onSelect={() => {
							value = '';
							open = false;
						}}
					>
						<span class="text-muted-foreground">{t('(empty)')}</span>
					</Command.Item>
					{#each options as option (option.value)}
						<Command.Item
							value={option.label}
							data-value={option.value}
							onSelect={() => {
								value = option.value;
								open = false;
							}}
						>
							{option.label}
						</Command.Item>
					{/each}
				</Command.Group>
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
