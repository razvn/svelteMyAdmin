<script lang="ts">
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		open: boolean;
		/** Translated dialog title, e.g. "Drop procedure p1?" */
		title: string;
		busy?: boolean;
		onconfirm: () => void;
	}

	let { open = $bindable(), title, busy = false, onconfirm }: Props = $props();
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content data-testid="confirm-drop">
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			<AlertDialog.Description>
				{t('This permanently deletes it and cannot be undone.')}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{t('Cancel')}</AlertDialog.Cancel>
			<AlertDialog.Action
				class={buttonVariants({ variant: 'destructive' })}
				disabled={busy}
				onclick={onconfirm}
			>
				{t('Drop')}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
