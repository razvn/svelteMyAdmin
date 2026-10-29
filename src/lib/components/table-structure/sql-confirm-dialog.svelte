<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { getNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { alterEnhance } from './alter-enhance.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		open: boolean;
		title: string;
		description?: string;
		/** The statement shown to the user (rebuilt by the server on submit). */
		sql: string;
		/** Form action name below the current page, e.g. `drop` -> `?/drop`. */
		action: string;
		payload: unknown;
		label?: string;
		destructive?: boolean;
		/** Toast text on success. */
		message: string;
		/** Refresh the left tree afterwards (default true). */
		refreshTree?: boolean;
		onsuccess?: () => void;
	}

	let {
		open = $bindable(),
		title,
		description,
		sql,
		action,
		payload,
		label,
		destructive = false,
		message,
		refreshTree = true,
		onsuccess
	}: Props = $props();

	const navState = getNavState();
	let busy = $state(false);
	let error = $state('');

	const submit = alterEnhance({
		start: () => {
			busy = true;
			error = '';
		},
		fail: (m) => {
			busy = false;
			error = m;
		},
		success: () => {
			busy = false;
			open = false;
			toast.success(message);
			onsuccess?.();
			if (refreshTree && page.params.db) void navState.load(page.params.db, true);
		}
	}, t);
</script>

<Dialog.Root bind:open onOpenChange={(o) => o && (error = '')}>
	<Dialog.Content class="max-w-2xl" data-testid="sql-confirm">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			{#if description}<Dialog.Description>{description}</Dialog.Description>{/if}
		</Dialog.Header>
		<pre
			class="max-h-72 overflow-auto rounded-lg border bg-muted p-3 font-mono text-sm whitespace-pre-wrap"
			data-testid="confirm-sql">{sql}</pre>
		{#if error}
			<Alert.Root variant="destructive" role="alert" data-testid="confirm-error">
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		{/if}
		<form method="POST" action="?/{action}" use:enhance={submit}>
			<input type="hidden" name="payload" value={JSON.stringify(payload)} />
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>{t('Cancel')}</Button>
				<Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy}>
					{label ?? t('Confirm')}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
