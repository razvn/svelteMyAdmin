<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		open: boolean;
		title: string;
		sql: string;
	}

	let { open = $bindable(), title, sql }: Props = $props();

	async function copy() {
		try {
			await navigator.clipboard.writeText(sql);
			toast.success(t('Copied to clipboard'));
		} catch {
			toast.error(t('Copy failed'));
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-3xl" data-testid="sql-dialog">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{t('The statement that re-creates this object.')}</Dialog.Description>
		</Dialog.Header>
		<pre
			class="max-h-96 overflow-auto rounded-lg border bg-muted p-3 font-mono text-[13px] whitespace-pre-wrap"
			data-testid="sql-dialog-text">{sql}</pre>
		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={copy}><Copy /> {t('Copy')}</Button>
			<Button type="button" onclick={() => (open = false)}>{t('Close')}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
