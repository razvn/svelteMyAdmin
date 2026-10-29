<script lang="ts">
	import { N_, useI18n } from '#lib/i18n/index.ts';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	const { t } = useI18n();

	interface Props {
		/** Selected column names. */
		selected: string[];
	}

	let { selected }: Props = $props();

	const submit =
		() =>
		async (e: {
			result: { type: string; data?: Record<string, unknown> };
			update: () => Promise<void>;
		}) => {
			const { result } = e;
			if (result.type === 'success') toast.success(String(result.data?.message ?? t('Done.')));
			else if (result.type === 'failure') toast.error(String(result.data?.error ?? t('Failed.')));
			await e.update();
		};
</script>

{#each [{ action: '?/centralAdd', label: N_('Add to central columns') }, { action: '?/centralRemove', label: N_('Remove from central columns') }] as item (item.action)}
	<form method="POST" action={item.action} use:enhance={submit} class="contents">
		{#each selected as name (name)}
			<input type="hidden" name="column" value={name} />
		{/each}
		<Button
			type="submit"
			variant="outline"
			size="sm"
			disabled={!hydration.ready || selected.length === 0}
		>
			{t(item.label)}
		</Button>
	</form>
{/each}
