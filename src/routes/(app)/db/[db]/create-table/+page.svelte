<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Table2 from '@lucide/svelte/icons/table-2';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import ColumnEditor from '#lib/components/columns/column-editor.svelte';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { getNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { bare } from '#lib/nav/paths.ts';
	import { tabHref } from '#lib/nav/tabs.ts';
	import { buildCreateTable, newColumn } from '#lib/sql/column-definition.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const navState = getNavState();

	/* The route data only seeds the form; the user's edits live in local state. */
	/* svelte-ignore state_referenced_locally */
	let tableName = $state(data.initialName);
	/* svelte-ignore state_referenced_locally */
	let columns = $state(Array.from({ length: data.numFields }, () => newColumn()));
	let comment = $state('');
	let collation = $state('');
	/* svelte-ignore state_referenced_locally */
	let engine = $state(data.defaultEngine);
	let saving = $state(false);
	let previewOpen = $state(false);
	let error = $state('');

	const tableOptions = $derived({ name: tableName, engine, collation, comment });
	const sql = $derived(buildCreateTable(data.db, tableOptions, columns, data.caps));
	const definition = $derived(
		JSON.stringify({ name: tableName, comment, collation, engine, columns })
	);

	const collationGroups = $derived.by(() => {
		const groups: { charset: string; list: string[] }[] = [];
		for (const c of data.collations) {
			let g = groups.find((x) => x.charset === c.charset);
			if (!g) groups.push((g = { charset: c.charset, list: [] }));
			g.list.push(c.name);
		}
		return groups;
	});
</script>

<svelte:head><title>Create table - {data.db}</title></svelte:head>

<div class="flex flex-col gap-6">
	<PageHeader
		icon={Table2}
		title="Create new table"
		description="Define the columns of a new table in database {data.db}."
	/>

	<form
		method="POST"
		action="?/create"
		class="flex flex-col gap-6"
		use:enhance={() => {
			saving = true;
			error = '';
			return async ({ result }) => {
				saving = false;
				if (result.type === 'success') {
					const table = String(result.data?.created ?? tableName);
					toast.success(`Table ${table} has been created.`);
					void navState.load(data.db, true);
					await goto(resolve(bare(tabHref('table', { db: data.db, table }, 'structure'))));
				} else if (result.type === 'failure') {
					error = String(result.data?.error ?? 'Could not create the table.');
				} else {
					error = 'Unexpected error while creating the table.';
				}
			};
		}}
	>
		<input type="hidden" name="definition" value={definition} />

		{#if error}
			<Alert.Root variant="destructive" role="alert" data-testid="create-error">
				<Alert.Title>Could not create the table</Alert.Title>
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title>Table</Card.Title>
			</Card.Header>
			<Card.Content class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<div class="flex flex-col gap-1.5">
					<Label for="table-name">Table name</Label>
					<Input
						id="table-name"
						bind:value={tableName}
						maxlength={64}
						required
						autocomplete="off"
						class="font-mono"
					/>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="table-comment">Table comments</Label>
					<Input id="table-comment" bind:value={comment} maxlength={60} autocomplete="off" />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label id="table-collation-label">Collation</Label>
					<Select.Root type="single" bind:value={collation}>
						<Select.Trigger
							class="w-full"
							aria-labelledby="table-collation-label"
							data-testid="table-collation"
						>
							<span class="truncate">{collation || '(default)'}</span>
						</Select.Trigger>
						<Select.Content class="max-h-80">
							<Select.Item value="" label="(default)">(default)</Select.Item>
							{#each collationGroups as group (group.charset)}
								<Select.Group>
									<Select.GroupHeading>{group.charset}</Select.GroupHeading>
									{#each group.list as name (name)}
										<Select.Item value={name} label={name}>{name}</Select.Item>
									{/each}
								</Select.Group>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label id="table-engine-label">Storage engine</Label>
					<Select.Root type="single" bind:value={engine}>
						<Select.Trigger
							class="w-full"
							aria-labelledby="table-engine-label"
							data-testid="table-engine"
						>
							{engine}
						</Select.Trigger>
						<Select.Content class="max-h-80">
							{#each data.engines as e (e.name)}
								<Select.Item value={e.name} label={e.name}>{e.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Structure</Card.Title>
				<Card.Description>
					Columns without a name are skipped. For ENUM and SET enter the values like
					<code class="font-mono">'a','b','c'</code>.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<ColumnEditor bind:columns caps={data.caps} collations={data.collations} />
			</Card.Content>
		</Card.Root>

		<div class="flex flex-wrap justify-end gap-2">
			<Button type="button" variant="outline" onclick={() => (previewOpen = true)}>
				Preview SQL
			</Button>
			<!-- the definition payload is built client-side: never post it before hydration -->
			<Button type="submit" disabled={saving || !hydration.ready}>Save</Button>
		</div>
	</form>
</div>

<Dialog.Root bind:open={previewOpen}>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Preview SQL</Dialog.Title>
			<Dialog.Description>The statement that Save will execute.</Dialog.Description>
		</Dialog.Header>
		<pre
			class="max-h-96 overflow-auto rounded-lg border bg-muted p-3 font-mono text-sm whitespace-pre-wrap"
			data-testid="preview-sql">{sql}</pre>
		<Dialog.Footer>
			<Button type="button" onclick={() => (previewOpen = false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
