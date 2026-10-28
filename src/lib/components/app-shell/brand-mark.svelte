<script lang="ts">
	import Database from '@lucide/svelte/icons/database';
	import { cn } from '#lib/utils.ts';

	interface Props {
		class?: string;
	}

	let { class: className }: Props = $props();
</script>

<!-- Logo mark: indigo rounded square with a database glyph. Decorative, the wordmark carries the name. -->
<span
	aria-hidden="true"
	class={cn(
		'flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs',
		className
	)}
>
	<Database class="size-5" />
</span>
