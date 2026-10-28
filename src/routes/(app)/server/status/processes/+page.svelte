<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { truncate } from '#lib/format.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { ProcessRow } from '#lib/server/admin/processes.ts';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form?: ActionData } = $props();

	const INTERVALS = ['2', '5', '10', '30'];
	const SHORT = 100;

	let onlyActive = $state(false);
	let showFull = $state(false);
	let autoRefresh = $state(false);
	let interval = $state('5');
	let killTarget = $state<ProcessRow | null>(null);
	let killOpen = $state(false);

	const rows = $derived(
		onlyActive ? data.processes.filter((p) => p.command !== 'Sleep') : data.processes
	);
	const hasProgress = $derived(data.processes.some((p) => p.progress !== null));

	$effect(() => {
		if (!autoRefresh) return;
		const timer = setInterval(() => void refreshAll(), Number(interval) * 1000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head>
	<title>Processes - svelteMyAdmin</title>
</svelte:head>

<Card.Root class="gap-0 py-0">
	<div class="flex flex-wrap items-center gap-x-6 gap-y-3 border-b p-5">
		<div class="flex items-center gap-2">
			<Checkbox id="only-active" bind:checked={onlyActive} />
			<Label for="only-active">Show only active</Label>
		</div>
		<div class="flex items-center gap-2">
			<Checkbox id="show-full" bind:checked={showFull} />
			<Label for="show-full">Show full queries</Label>
		</div>
		<div class="flex items-center gap-2">
			<Checkbox id="auto-refresh" bind:checked={autoRefresh} />
			<Label for="auto-refresh">Auto refresh every</Label>
			<Select.Root type="single" bind:value={interval}>
				<Select.Trigger class="w-24" aria-label="Refresh interval" data-testid="interval">
					{interval} s
				</Select.Trigger>
				<Select.Content>
					{#each INTERVALS as i (i)}
						<Select.Item value={i} label="{i} s">{i} s</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<Button variant="outline" size="sm" class="ms-auto" onclick={() => refreshAll()}>
			<RefreshCw />
			Refresh now
		</Button>
	</div>

	{#if form?.killError}
		<p
			role="alert"
			class="border-b bg-destructive-soft px-5 py-3 text-sm text-destructive"
			data-testid="kill-error"
		>
			{form.killError}
		</p>
	{:else if form?.killed}
		<p
			role="status"
			class="border-b bg-success-soft px-5 py-3 text-sm text-success"
			data-testid="kill-ok"
		>
			Thread {form.killed} was killed.
		</p>
	{/if}

	<Table.Root data-testid="process-table">
		<Table.Header>
			<Table.Row>
				<Table.Head></Table.Head>
				<Table.Head>ID</Table.Head>
				<Table.Head>User</Table.Head>
				<Table.Head>Host</Table.Head>
				<Table.Head>Database</Table.Head>
				<Table.Head>Command</Table.Head>
				<Table.Head class="text-end">Time</Table.Head>
				<Table.Head>Status</Table.Head>
				{#if hasProgress}<Table.Head class="text-end">Progress</Table.Head>{/if}
				<Table.Head>SQL query</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as p (p.id)}
				<Table.Row data-process-id={p.id}>
					<Table.Cell>
						{#if p.id === data.ownId}
							<Badge variant="primary">this connection</Badge>
						{:else}
							<Button
								variant="destructive"
								size="xs"
								onclick={() => {
									killTarget = p;
									killOpen = true;
								}}
							>
								Kill
							</Button>
						{/if}
					</Table.Cell>
					<Table.Cell class="tabular-nums">{p.id}</Table.Cell>
					<Table.Cell>{p.user}</Table.Cell>
					<Table.Cell>{p.host}</Table.Cell>
					<Table.Cell>{p.db ?? ''}</Table.Cell>
					<Table.Cell>
						<Badge variant={p.command === 'Sleep' ? 'muted' : 'success'}>{p.command}</Badge>
					</Table.Cell>
					<Table.Cell class="text-end tabular-nums">{p.time}</Table.Cell>
					<Table.Cell>{p.state}</Table.Cell>
					{#if hasProgress}
						<Table.Cell class="text-end tabular-nums">
							{p.progress === null ? '' : `${p.progress}%`}
						</Table.Cell>
					{/if}
					<Table.Cell class="max-w-xl font-mono text-xs break-all whitespace-pre-wrap">
						{p.info === null ? '' : showFull ? p.info : truncate(p.info, SHORT)}
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell colspan={10} class="text-center text-muted-foreground"
						>No processes.</Table.Cell
					>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</Card.Root>

<AlertDialog.Root bind:open={killOpen}>
	<AlertDialog.Content data-testid="kill-dialog">
		<AlertDialog.Header>
			<AlertDialog.Title>Kill process {killTarget?.id}?</AlertDialog.Title>
			<AlertDialog.Description>
				Process {killTarget?.id} ({killTarget?.user}@{killTarget?.host}) will be terminated with
				<code>KILL {killTarget?.id}</code>.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<form
				method="POST"
				action="?/kill"
				use:enhance={() => {
					return async ({ update }) => {
						await update();
						killOpen = false;
					};
				}}
			>
				<input type="hidden" name="id" value={killTarget?.id ?? ''} />
				<AlertDialog.Action type="submit" data-testid="kill-confirm">Kill</AlertDialog.Action>
			</form>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
