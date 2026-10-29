<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { cn, type WithoutChildrenOrChild } from '#lib/utils.ts';
	import Command from './command.svelte';
	import type { Command as CommandPrimitive, Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	const { t } = useI18n();

	let {
		open = $bindable(false),
		ref = $bindable(null),
		value = $bindable(''),
		title,
		description,
		showCloseButton = false,
		portalProps,
		children,
		class: className,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.RootProps> &
		WithoutChildrenOrChild<CommandPrimitive.RootProps> & {
			portalProps?: DialogPrimitive.PortalProps;
			children: Snippet;
			title?: string;
			description?: string;
			showCloseButton?: boolean;
			class?: string;
		} = $props();
</script>

<Dialog.Root bind:open {...restProps}>
	<Dialog.Header class="sr-only">
		<Dialog.Title>{title ?? t('Command Palette')}</Dialog.Title>
		<Dialog.Description>{description ?? t('Search for a command to run...')}</Dialog.Description>
	</Dialog.Header>
	<Dialog.Content
		class={cn('top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0', className)}
		{showCloseButton}
		{portalProps}
	>
		<Command {...restProps} bind:value bind:ref {children} />
	</Dialog.Content>
</Dialog.Root>
