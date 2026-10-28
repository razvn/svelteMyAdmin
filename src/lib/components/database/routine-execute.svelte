<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import { page } from '$app/state';
	import { callAction } from '#lib/forms/call-action.ts';
	import type { RoutineDef } from '#lib/sql/routine.ts';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';

	interface ResultSet {
		columns: string[];
		rows: (string | null)[][];
	}
	interface ExecuteResult {
		ok: boolean;
		error?: string;
		queries: string[];
		resultSets: ResultSet[];
		outParams: { name: string; value: string | null }[];
		affectedRows: number | null;
	}

	interface Props {
		open: boolean;
		routine: RoutineDef;
	}

	let { open = $bindable(), routine }: Props = $props();

	/** The parent re-creates this component (keyed) for every routine, so the initial values suffice. */
	const initialValues = () => routine.params.map(() => ({ value: '', isNull: false }));
	let values = $state(initialValues());
	let running = $state(false);
	let result = $state.raw<ExecuteResult | null>(null);
	let failure = $state<string | null>(null);

	async function run(event: SubmitEvent) {
		event.preventDefault();
		running = true;
		failure = null;
		const res = await callAction<{ result?: ExecuteResult }>(page.url.pathname, 'execute', {
			type: routine.type,
			name: routine.name,
			params: JSON.stringify(
				routine.params.map((p, i) => ({
					direction: routine.type === 'FUNCTION' ? 'IN' : p.direction,
					name: p.name,
					type: p.type,
					value: values[i]?.value ?? '',
					isNull: values[i]?.isNull ?? false
				}))
			)
		});
		running = false;
		if (res.ok && res.data?.result) result = res.data.result;
		else {
			result = null;
			failure = res.message ?? 'Execution failed.';
		}
	}
</script>

{#snippet grid(set: ResultSet, testid: string)}
	<div class="overflow-x-auto rounded-lg border" data-testid={testid}>
		<Table.Root>
			<Table.Header>
				<Table.Row>
					{#each set.columns as column, i (i)}<Table.Head>{column}</Table.Head>{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each set.rows as row, r (r)}
					<Table.Row>
						{#each row as value, c (c)}
							<Table.Cell class="font-mono text-[13px]">
								{#if value === null}<span class="text-muted-foreground italic">NULL</span
									>{:else}{value}{/if}
							</Table.Cell>
						{/each}
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={Math.max(1, set.columns.length)} class="text-muted-foreground">
							Empty result set.
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
{/snippet}

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-testid="routine-execute">
		<Dialog.Header>
			<Dialog.Title>Execute {routine.type.toLowerCase()} {routine.name}</Dialog.Title>
			<Dialog.Description>Enter values for the input parameters.</Dialog.Description>
		</Dialog.Header>

		<form class="grid gap-3" onsubmit={run}>
			{#each routine.params as param, i (i)}
				{#if routine.type === 'FUNCTION' || param.direction !== 'OUT'}
					<div class="grid items-center gap-2 sm:grid-cols-[10rem_1fr_auto]">
						<Label for="exec-{i}" class="font-mono text-[13px]">
							{param.name} <span class="text-muted-foreground">{param.type}</span>
						</Label>
						<Input
							id="exec-{i}"
							aria-label="Value of {param.name}"
							disabled={values[i]?.isNull}
							bind:value={values[i].value}
						/>
						<div class="flex items-center gap-1.5 text-sm">
							<Checkbox
								id="exec-null-{i}"
								aria-label="NULL for {param.name}"
								bind:checked={values[i].isNull}
							/>
							<Label for="exec-null-{i}">NULL</Label>
						</div>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">
						<span class="font-mono">{param.name}</span> is an OUT parameter; its value is shown after
						the call.
					</p>
				{/if}
			{:else}
				<p class="text-sm text-muted-foreground">This routine takes no parameters.</p>
			{/each}
			<div>
				<Button type="submit" disabled={running} data-testid="routine-run">
					<Play />
					{running ? 'Running...' : 'Execute'}
				</Button>
			</div>
		</form>

		{#if failure}
			<Alert.Root variant="destructive">{failure}</Alert.Root>
		{/if}
		{#if result}
			<div class="grid gap-3" data-testid="routine-result">
				{#if result.ok}
					<Alert.Root variant="success">
						Your SQL query has been executed successfully.
						{#if result.affectedRows !== null}
							{result.affectedRows} row(s) affected by the last statement inside the procedure.
						{/if}
					</Alert.Root>
				{:else}
					<Alert.Root variant="destructive" data-testid="routine-run-error">
						{result.error}
					</Alert.Root>
				{/if}
				<pre
					class="overflow-auto rounded-lg border bg-muted p-2 font-mono text-xs">{result.queries.join(
						';\n'
					)}</pre>
				{#each result.resultSets as set, i (i)}
					{@render grid(set, `result-set-${i}`)}
				{/each}
				{#if result.outParams.length > 0}
					<div>
						<h3 class="mb-1 text-sm font-medium">Output parameters</h3>
						{@render grid(
							{
								columns: result.outParams.map((o) => o.name),
								rows: [result.outParams.map((o) => o.value)]
							},
							'result-out'
						)}
					</div>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
