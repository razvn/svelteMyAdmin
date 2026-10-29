<script lang="ts">
	import logo from '#lib/assets/logo.svg';
	import { cn } from '#lib/utils.ts';

	interface Props {
		class?: string;
	}

	let { class: className }: Props = $props();
</script>

<!--
	Logo mark (docs/logo.svg): an original design — a database stack wrapped by a flowing "S" ribbon.
	It deliberately reuses no Svelte, MySQL or MariaDB trademark artwork. Decorative: the wordmark
	next to it carries the name.
-->
<img
	src={logo}
	alt=""
	aria-hidden="true"
	width="36"
	height="36"
	class={cn('size-9 shrink-0 rounded-[24%] shadow-xs', className)}
/>
