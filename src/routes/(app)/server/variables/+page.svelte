<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Check from '@lucide/svelte/icons/check';
	import Pencil from '@lucide/svelte/icons/pencil';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { matchesFilter } from '#lib/admin/filter.ts';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import * as Tooltip from '#lib/components/ui/tooltip/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let filter = $state(page.url.searchParams.get('filter') ?? '');
	let editing = $state<string | null>(null);
	let draft = $state('');
	let saving = $state(false);
	/** Names of the long values the user expanded with "Show more". */
	let expanded = $state<Record<string, boolean>>({});

	const visible = $derived(data.variables.filter((v) => matchesFilter(filter, v.name)));

	/** Values longer than this are clamped to a few lines until expanded. */
	const CLAMP_LENGTH = 120;

	function startEdit(name: string, value: string) {
		editing = name;
		draft = value;
	}
</script>

<svelte:head>
	<title>Server variables - svelteMyAdmin</title>
</svelte:head>

{#snippet valueText(name: string, text: string)}
	{#if text.length > CLAMP_LENGTH}
		<div class="flex flex-col items-end gap-1">
			<span class={expanded[name] ? 'break-all' : 'line-clamp-3 break-all'}>{text}</span>
			<Button
				type="button"
				variant="link"
				size="sm"
				class="h-auto p-0 font-sans"
				aria-expanded={expanded[name] ?? false}
				onclick={() => (expanded[name] = !expanded[name])}
			>
				{expanded[name] ? 'Show less' : 'Show more'}
			</Button>
		</div>
	{:else}
		<span class="break-all">{text}</span>
	{/if}
{/snippet}

<div class="flex flex-col gap-6">
	<PageHeader
		icon={SlidersHorizontal}
		title="Server variables and settings"
		description="Global server variables. Click the pencil to change a value at runtime."
	/>

	<Card.Root class="gap-0 py-0">
		<div class="flex flex-wrap items-center justify-between gap-3 border-b p-5">
			<div class="relative w-full max-w-sm">
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
			<p class="ms-auto text-sm text-muted-foreground" data-testid="variables-count">
				{visible.length} of {data.variables.length} variables shown
			</p>
		</div>

		<Card.Content class="grid gap-0 px-0">
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
					<Table.Root class="table-fixed" data-testid="variables-table">
						<Table.Header>
							<Table.Row>
								<Table.Head class="w-24">Action</Table.Head>
								<Table.Head class="w-56">Variable</Table.Head>
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
									<Table.Cell class="font-medium break-all whitespace-normal">{v.name}</Table.Cell>
									<Table.Cell class="text-end font-mono text-[13px] whitespace-normal">
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
											{@render valueText(v.name, v.display)}
										{/if}
									</Table.Cell>
								</Table.Row>
								{#if v.sessionDisplay !== null}
									<Table.Row class="text-muted-foreground italic" data-testid="session-row">
										<Table.Cell></Table.Cell>
										<Table.Cell class="break-all whitespace-normal">
											{v.name} (Session value)
										</Table.Cell>
										<Table.Cell class="text-end font-mono text-[13px] whitespace-normal">
											{@render valueText(`${v.name} (session)`, v.sessionDisplay)}
										</Table.Cell>
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
</div>
