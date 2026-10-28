<script lang="ts">
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';

	interface Props {
		open: boolean;
		/** e.g. "procedure `p1`" */
		subject: string;
		busy?: boolean;
		onconfirm: () => void;
	}

	let { open = $bindable(), subject, busy = false, onconfirm }: Props = $props();
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content data-testid="confirm-drop">
		<AlertDialog.Header>
			<AlertDialog.Title>Drop {subject}?</AlertDialog.Title>
			<AlertDialog.Description>
				This permanently deletes it and cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class={buttonVariants({ variant: 'destructive' })}
				disabled={busy}
				onclick={onconfirm}
			>
				Drop
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
