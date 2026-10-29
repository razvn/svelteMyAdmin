<script lang="ts">
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import ColumnEditor from '#lib/components/columns/column-editor.svelte';
	import { getNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { bare } from '#lib/nav/paths.ts';
	import { tabHref } from '#lib/nav/tabs.ts';
	import {
		buildAddColumns,
		buildChangeColumns,
		type ColumnPlacement
	} from '#lib/sql/alter-table.ts';
	import type { ColumnDef, ServerCaps } from '#lib/sql/column-definition.ts';
	import type { TransformUi } from '#lib/server/transformations/structure.ts';
	import { emptySettings, type ColumnTransformSettings } from '#lib/transformations/ui.ts';
	import TransformationFields from './transformation-fields.svelte';
	import { alterEnhance } from './alter-enhance.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		mode: 'add' | 'change';
		columns: ColumnDef[];
		caps: ServerCaps;
		collations: { name: string; charset: string }[];
		db: string;
		table: string;
		/** Add mode: where the new columns go. */
		placement?: ColumnPlacement;
		/** Add mode: the table already has a PRIMARY KEY. */
		hasPrimary?: boolean;
		/** Media type / transformation fields; null when the column_info storage is unavailable. */
		transformUi?: TransformUi | null;
	}

	let {
		mode,
		columns: initial,
		caps,
		collations,
		db,
		table,
		placement = { where: 'end' },
		hasPrimary = false,
		transformUi = null
	}: Props = $props();

	const navState = getNavState();
	/* The route data only seeds the form; the user's edits live in local state. */
	/* svelte-ignore state_referenced_locally */
	let columns = $state<ColumnDef[]>(structuredClone($state.snapshot(initial)));
	/* svelte-ignore state_referenced_locally */
	const oldNames = initial.map((c) => c.name);
	let busy = $state(false);
	let error = $state('');
	let previewOpen = $state(false);

	/* Transformation settings by column id; seeded from the route data like `columns`. */
	/* svelte-ignore state_referenced_locally */
	let transforms = $state<Record<number, ColumnTransformSettings>>({
		...Object.fromEntries(initial.map((c) => [c.id, emptySettings()])),
		...structuredClone($state.snapshot(transformUi?.byId ?? {}))
	});
	// columns added in the editor get empty settings
	$effect(() => {
		for (const col of columns) {
			if (!(col.id in transforms)) transforms[col.id] = emptySettings();
		}
	});
	const settingsOf = (id: number): ColumnTransformSettings => transforms[id] ?? emptySettings();
	const transformations = $derived(
		transformUi
			? columns.flatMap((col, i) =>
					col.name.trim() === ''
						? []
						: [
								{
									column: col.name,
									...(mode === 'change' && oldNames[i] !== col.name
										? { oldName: oldNames[i] }
										: {}),
									...settingsOf(col.id)
								}
							]
				)
			: undefined
	);
	const sql = $derived(
		mode === 'add'
			? buildAddColumns(db, table, columns, caps, placement, { tableHasPrimary: hasPrimary })
			: buildChangeColumns(
					db,
					table,
					columns.map((col, i) => ({ oldName: oldNames[i], col })),
					caps
				)
	);
	const payload = $derived(
		mode === 'add'
			? { columns, placement, transformations }
			: { changes: columns.map((col, i) => ({ oldName: oldNames[i], col })), transformations }
	);
	const structureHref = $derived(resolve(bare(tabHref('table', { db, table }, 'structure'))));

	const submit = alterEnhance(
		{
			start: () => {
				busy = true;
				error = '';
			},
			fail: (m) => {
				busy = false;
				error = m;
				previewOpen = false;
			},
			success: async () => {
				busy = false;
				toast.success(
					mode === 'add'
						? t('The columns have been added.')
						: t('The table has been altered successfully.')
				);
				void navState.load(db, true);
				await goto(structureHref);
			}
		},
		t
	);
</script>

{#snippet extra({ col, index }: { col: ColumnDef; index: number })}
	{#if transformUi && transforms[col.id]}
		<TransformationFields
			bind:value={transforms[col.id]}
			choices={transformUi.choices}
			n={index + 1}
		/>
	{/if}
{/snippet}

<form method="POST" action="?/{mode}" class="flex flex-col gap-6" use:enhance={submit}>
	<input type="hidden" name="payload" value={JSON.stringify(payload)} />

	{#if error}
		<Alert.Root variant="destructive" role="alert" data-testid="alter-error">
			<Alert.Title>{t('Could not alter the table')}</Alert.Title>
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>{mode === 'add' ? t('New columns') : t('Change columns')}</Card.Title>
			<Card.Description>
				{#if mode === 'add'}
					{t(
						"Columns without a name are skipped. For ENUM and SET enter the values like 'a','b','c'."
					)}
				{:else}
					{t('Rename a column or change its definition. Indexes and foreign keys are kept.')}
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if mode === 'add'}
				<ColumnEditor bind:columns {caps} {collations} centralDb={db} {extra} />
			{:else}
				<ColumnEditor
					bind:columns
					{caps}
					{collations}
					showIndex={false}
					showAutoIncrement
					fixed
					{extra}
				/>
			{/if}
		</Card.Content>
	</Card.Root>

	<div class="flex flex-wrap justify-end gap-2">
		<Button type="button" variant="outline" href={structureHref}>{t('Cancel')}</Button>
		<Button type="button" variant="outline" onclick={() => (previewOpen = true)}>
			{t('Preview SQL')}
		</Button>
		<Button type="submit" disabled={busy || !hydration.ready}>{t('Save')}</Button>
	</div>
</form>

<Dialog.Root bind:open={previewOpen}>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{t('Preview SQL')}</Dialog.Title>
			<Dialog.Description>{t('The statement that Save will execute.')}</Dialog.Description>
		</Dialog.Header>
		<pre
			class="max-h-96 overflow-auto rounded-lg border bg-muted p-3 font-mono text-sm whitespace-pre-wrap"
			data-testid="preview-sql">{sql}</pre>
		<Dialog.Footer>
			<Button type="button" onclick={() => (previewOpen = false)}>{t('Close')}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
