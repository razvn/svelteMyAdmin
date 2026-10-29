<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		results: { statement: string; rows: Record<string, string>[] }[];
	}

	let { results }: Props = $props();

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(t('Copied to clipboard.'));
		} catch {
			toast.error(t('Could not copy.'));
		}
	}

	const columns = (r: Record<string, string>[]) => (r.length ? Object.keys(r[0]) : []);
</script>

{#each results as r (r.statement)}
	<div class="flex items-center justify-between gap-2">
		<code class="font-mono text-xs text-muted-foreground">{r.statement}</code>
		<Button variant="outline" size="sm" onclick={() => copy(r.statement)}>
			<Copy /> {t('Copy')}
		</Button>
	</div>
	<Table.Root data-testid="maintenance-result">
		<Table.Header>
			<Table.Row>
				{#each columns(r.rows) as c (c)}<Table.Head>{c}</Table.Head>{/each}
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each r.rows as row, i (i)}
				<Table.Row>
					{#each columns(r.rows) as c (c)}
						<Table.Cell class="font-mono whitespace-normal">{row[c]}</Table.Cell>
					{/each}
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/each}
