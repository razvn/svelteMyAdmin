<script lang="ts">
	import {
		buildCreateTable,
		newColumn,
		type ColumnDef,
		type ServerCaps
	} from '#lib/sql/column-definition.ts';
	import ColumnEditor from '../column-editor.svelte';

	interface Props {
		caps: ServerCaps;
		initial?: number;
	}

	let { caps, initial = 2 }: Props = $props();

	// svelte-ignore state_referenced_locally
	let columns = $state<ColumnDef[]>(
		Array.from({ length: initial }, (_, i) => newColumn({ name: `c${i + 1}` }))
	);
	const sql = $derived(buildCreateTable('d', { name: 't' }, columns, caps));
</script>

<ColumnEditor bind:columns {caps} collations={[{ name: 'utf8mb4_bin', charset: 'utf8mb4' }]} />
<pre data-testid="sql">{sql}</pre>
