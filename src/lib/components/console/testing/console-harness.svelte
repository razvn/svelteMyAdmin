<script lang="ts">
	import ConsoleDrawer from '../console-drawer.svelte';
	import { ConsoleState, setConsoleState } from '../console-state.svelte.ts';

	interface Props {
		db?: string;
		table?: string;
		/** Receives the state so tests can drive it. */
		onstate?: (s: ConsoleState) => void;
	}

	let { db = '', table = '', onstate }: Props = $props();

	const consoleState = new ConsoleState();
	setConsoleState(consoleState);
	// svelte-ignore state_referenced_locally
	onstate?.(consoleState);
</script>

<button type="button" onclick={() => consoleState.toggle()}>Toggle SQL console</button>
<ConsoleDrawer {db} {table} />
