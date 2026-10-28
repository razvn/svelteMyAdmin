<script lang="ts">
	interface Props {
		rows: { label: string; value: string | number; testid?: string }[];
	}

	let { rows }: Props = $props();
</script>

<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
	{#each rows as row (row.label)}
		<dt class="text-muted-foreground">{row.label}</dt>
		<dd class="font-medium break-words" data-testid={row.testid}>{row.value}</dd>
	{/each}
</dl>
