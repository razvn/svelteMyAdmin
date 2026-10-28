<script lang="ts">
	import { enhance } from '$app/forms';
	import Check from '@lucide/svelte/icons/check';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { matchesFilter } from '#lib/admin/filter.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import * as Tooltip from '#lib/components/ui/tooltip/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let filter = $state('');
	let editing = $state<string | null>(null);
	let draft = $state('');
	let saving = $state(false);

	const visible = $derived(data.variables.filter((v) => matchesFilter(filter, v.name)));

	function startEdit(name: string, value: string) {
		editing = name;
		draft = value;
	}
</script>

<svelte:head>
	<title>Server variables - svelteMyAdmin</title>
</svelte:head>

<Card.Root>
	<Card.Header>
		<Card.Title><h1 class="text-xl font-semibold">Server variables and settings</h1></Card.Title>
		<Card.Description data-testid="variables-count">
			{visible.length} of {data.variables.length} variables shown
		</Card.Description>
	</Card.Header>
	<Card.Content class="grid gap-4">
		<div class="relative max-w-sm">
			<Search class="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="search"
				class="ps-8"
				placeholder="Filter by variable name"
				aria-label="Filter variables"
				data-testid="variables-filter"
				bind:value={filter}
			/>
		</div>

		<!-- Single edit form for the row being edited; the row inputs and buttons attach to it by id. -->
		<form
			id="variable-edit"
			method="POST"
			action="?/save"
			use:enhance={({ formData }) => {
				saving = true;
				const name = String(formData.get('name') ?? '');
				return async ({ result, update }) => {
					saving = false;
					if (result.type === 'success') {
						const saved = result.data?.saved as { value: string } | undefined;
						toast.success(`${name} is now ${saved?.value ?? ''}`);
						editing = null;
					} else if (result.type === 'failure') {
						const message = result.data?.error;
						toast.error(typeof message === 'string' ? message : 'Setting the variable failed.');
					}
					await update({ reset: false });
				};
			}}
		>
			<input type="hidden" name="name" value={editing ?? ''} />
		</form>

		<div class="overflow-x-auto">
			<Tooltip.Provider>
				<Table.Root data-testid="variables-table">
					<Table.Header>
						<Table.Row>
							<Table.Head class="w-24">Action</Table.Head>
							<Table.Head>Variable</Table.Head>
							<Table.Head class="text-end">Value</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each visible as v (v.name)}
							<Table.Row data-testid="variable-row" data-variable={v.name}>
								<Table.Cell>
									{#if editing === v.name}
										<div class="flex gap-1">
											<Button
												type="submit"
												form="variable-edit"
												size="icon-sm"
												aria-label="Save {v.name}"
												disabled={saving}
											>
												<Check />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												aria-label="Cancel editing {v.name}"
												onclick={() => (editing = null)}
											>
												<X />
											</Button>
										</div>
									{:else}
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label="Edit {v.name}"
											onclick={() => startEdit(v.name, v.value)}
										>
											<Pencil />
										</Button>
									{/if}
								</Table.Cell>
								<Table.Cell class="font-medium">{v.name}</Table.Cell>
								<Table.Cell class="text-end font-mono">
									{#if editing === v.name}
										<Input
											form="variable-edit"
											name="value"
											class="ms-auto w-72 font-mono"
											aria-label="New value for {v.name}"
											placeholder={v.title !== undefined ? 'e.g. 128 MB or bytes' : ''}
											bind:value={draft}
											data-testid="variable-input"
										/>
									{:else if v.title !== undefined}
										<Tooltip.Root>
											<Tooltip.Trigger
												class="cursor-help underline decoration-dotted underline-offset-4"
												data-testid="byte-value"
											>
												{v.display}
											</Tooltip.Trigger>
											<Tooltip.Content>{v.title}</Tooltip.Content>
										</Tooltip.Root>
									{:else}
										{v.display}
									{/if}
								</Table.Cell>
							</Table.Row>
							{#if v.sessionDisplay !== null}
								<Table.Row class="text-muted-foreground italic" data-testid="session-row">
									<Table.Cell></Table.Cell>
									<Table.Cell>{v.name} (Session value)</Table.Cell>
									<Table.Cell class="text-end font-mono">{v.sessionDisplay}</Table.Cell>
								</Table.Row>
							{/if}
						{:else}
							<Table.Row>
								<Table.Cell colspan={3} class="text-center text-muted-foreground">
									No variables match the filter.
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Tooltip.Provider>
		</div>
	</Card.Content>
</Card.Root>
