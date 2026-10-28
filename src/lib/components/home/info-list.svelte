<script lang="ts">
	interface Props {
		rows: { label: string; value: string | number; testid?: string }[];
	}

	let { rows }: Props = $props();
</script>

<dl class="divide-y text-sm">
	{#each rows as row (row.label)}
		<div class="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
			<dt class="shrink-0 text-muted-foreground">{row.label}</dt>
			<dd class="min-w-0 text-end font-medium break-words" data-testid={row.testid}>{row.value}</dd>
		</div>
	{/each}
</dl>
