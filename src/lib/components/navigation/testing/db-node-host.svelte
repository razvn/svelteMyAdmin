<script lang="ts">
	/** Test host: DbNode needs the sidebar context. */
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import type { NavConfig } from '#lib/nav/config.ts';
	import DbNode from '../db-node.svelte';
	import type { NavState } from '../nav-state.svelte.ts';

	interface Props {
		name: string;
		nav: NavConfig;
		navState: NavState;
		currentDb?: string;
		currentTable?: string;
	}

	let { name, nav, navState, currentDb, currentTable }: Props = $props();
</script>

<Sidebar.Provider>
	<Sidebar.Menu>
		<DbNode {name} {nav} {navState} {currentDb} {currentTable} />
	</Sidebar.Menu>
</Sidebar.Provider>
