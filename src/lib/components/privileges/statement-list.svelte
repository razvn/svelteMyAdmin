<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';

	interface Item {
		statement: string;
		ok: boolean;
		error?: string;
	}

	let { results, title = 'Executed statements' }: { results: Item[]; title?: string } = $props();
</script>

{#if results.length > 0}
	<section aria-label={title} data-testid="statement-list" class="grid gap-2">
		<h2 class="text-sm font-semibold">{title}</h2>
		<ol class="grid gap-2">
			{#each results as r, i (i)}
				<li
					class="flex items-start gap-2 rounded-lg border bg-muted/40 p-3"
					data-ok={r.ok ? 'true' : 'false'}
				>
					{#if r.ok}
						<CircleCheck class="mt-0.5 size-4 shrink-0 text-success" aria-label="Succeeded" />
					{:else}
						<CircleX class="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />
					{/if}
					<div class="grid min-w-0 gap-1">
						<code class="font-mono text-xs break-all whitespace-pre-wrap">{r.statement};</code>
						{#if r.error}
							<span class="text-xs text-destructive">{r.error}</span>
						{/if}
					</div>
				</li>
			{/each}
		</ol>
	</section>
{/if}
