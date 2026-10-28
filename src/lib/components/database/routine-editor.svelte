<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { page } from '$app/state';
	import { callAction } from '#lib/forms/call-action.ts';
	import type { RoutineDef } from '#lib/sql/routine.ts';
	import {
		NUMERIC_OPTIONS,
		PARAM_DIRECTIONS,
		ROUTINE_DATA_TYPES,
		ROUTINE_TYPES,
		SECURITY_TYPES,
		SQL_DATA_ACCESS,
		optionsKind
	} from '#lib/sql/routine-types.ts';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import SelectField from './select-field.svelte';

	interface Props {
		open: boolean;
		def: RoutineDef;
		/** The routine being edited, or null when adding. */
		original: { type: RoutineDef['type']; name: string } | null;
		onsaved: (name: string) => void;
	}

	let { open = $bindable(), def = $bindable(), original, onsaved }: Props = $props();

	let errors = $state<string[]>([]);
	let saving = $state(false);

	function addParam() {
		def.params.push({ direction: 'IN', name: '', type: 'INT', length: '', opts: '' });
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		errors = [];
		const res = await callAction<{ errors?: string[] }>(page.url.pathname, 'save', {
			payload: JSON.stringify($state.snapshot(def)),
			original: original ? JSON.stringify(original) : ''
		});
		saving = false;
		if (res.ok) {
			open = false;
			onsaved(def.name);
		} else {
			errors = res.data?.errors ?? [res.message ?? 'Saving the routine failed.'];
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-testid="routine-editor">
		<Dialog.Header>
			<Dialog.Title>{original ? `Edit ${original.type.toLowerCase()}` : 'Add routine'}</Dialog.Title
			>
			<Dialog.Description>
				Editing drops and re-creates the routine; the original is restored if creation fails.
			</Dialog.Description>
		</Dialog.Header>

		<form class="grid gap-4" onsubmit={save}>
			{#if errors.length > 0}
				<Alert.Root variant="destructive" data-testid="routine-errors">
					<ul class="list-inside list-disc">
						{#each errors as message (message)}<li>{message}</li>{/each}
					</ul>
				</Alert.Root>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="grid gap-1.5">
					<Label for="routine-name">Routine name</Label>
					<Input id="routine-name" bind:value={def.name} autocomplete="off" />
				</div>
				<div class="grid gap-1.5">
					<Label id="routine-type-label">Type</Label>
					<SelectField
						label="Type"
						bind:value={def.type}
						options={ROUTINE_TYPES}
						testid="routine-type"
					/>
				</div>
			</div>

			<fieldset class="grid gap-2">
				<legend class="mb-1 text-sm font-medium">Parameters</legend>
				{#each def.params as param, i (i)}
					<div
						class="grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[6rem_1fr_8rem_6rem_9rem_auto]"
						data-testid="routine-param"
					>
						{#if def.type === 'PROCEDURE'}
							<SelectField
								label="Direction of parameter {i + 1}"
								bind:value={param.direction}
								options={PARAM_DIRECTIONS}
								class="w-full"
							/>
						{:else}
							<span class="text-sm text-muted-foreground">IN</span>
						{/if}
						<Input
							placeholder="Name"
							aria-label="Name of parameter {i + 1}"
							bind:value={param.name}
						/>
						<SelectField
							label="Type of parameter {i + 1}"
							bind:value={param.type}
							options={ROUTINE_DATA_TYPES}
						/>
						<Input
							placeholder="Length"
							aria-label="Length of parameter {i + 1}"
							bind:value={param.length}
						/>
						{#if optionsKind(param.type) === 'numeric'}
							<SelectField
								label="Options of parameter {i + 1}"
								bind:value={param.opts}
								options={NUMERIC_OPTIONS}
								emptyLabel="(none)"
							/>
						{:else if optionsKind(param.type) === 'charset'}
							<Input
								placeholder="Charset"
								aria-label="Charset of parameter {i + 1}"
								bind:value={param.opts}
							/>
						{:else}
							<span></span>
						{/if}
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Remove parameter {i + 1}"
							onclick={() => def.params.splice(i, 1)}
						>
							<Trash2 />
						</Button>
					</div>
				{/each}
				<div>
					<Button type="button" variant="outline" size="sm" onclick={addParam}>
						<Plus /> Add parameter
					</Button>
				</div>
			</fieldset>

			{#if def.type === 'FUNCTION'}
				<div class="grid gap-2 sm:grid-cols-3">
					<div class="grid gap-1.5">
						<Label>Return type</Label>
						<SelectField
							label="Return type"
							bind:value={def.returns.type}
							options={ROUTINE_DATA_TYPES}
						/>
					</div>
					<div class="grid gap-1.5">
						<Label for="routine-return-length">Return length/values</Label>
						<Input id="routine-return-length" bind:value={def.returns.length} />
					</div>
					<div class="grid gap-1.5">
						<Label for="routine-return-opts">Return options</Label>
						{#if optionsKind(def.returns.type) === 'numeric'}
							<SelectField
								label="Return options"
								bind:value={def.returns.opts}
								options={NUMERIC_OPTIONS}
								emptyLabel="(none)"
							/>
						{:else if optionsKind(def.returns.type) === 'charset'}
							<Input id="routine-return-opts" placeholder="Charset" bind:value={def.returns.opts} />
						{:else}
							<Input id="routine-return-opts" disabled />
						{/if}
					</div>
				</div>
			{/if}

			<div class="grid gap-1.5">
				<Label for="routine-definition">Definition</Label>
				<Textarea
					id="routine-definition"
					class="min-h-40 font-mono text-[13px]"
					spellcheck={false}
					bind:value={def.definition}
				/>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex items-center gap-2">
					<Checkbox id="routine-deterministic" bind:checked={def.deterministic} />
					<Label for="routine-deterministic">Is deterministic</Label>
				</div>
				<div class="grid gap-1.5">
					<Label for="routine-definer">Definer (user@host)</Label>
					<Input id="routine-definer" bind:value={def.definer} placeholder="root@localhost" />
				</div>
				<div class="grid gap-1.5">
					<Label>Security type</Label>
					<SelectField
						label="Security type"
						bind:value={def.securityType}
						options={SECURITY_TYPES}
						emptyLabel="(default)"
					/>
				</div>
				<div class="grid gap-1.5">
					<Label>SQL data access</Label>
					<SelectField
						label="SQL data access"
						bind:value={def.sqlDataAccess}
						options={SQL_DATA_ACCESS}
						emptyLabel="(default)"
					/>
				</div>
			</div>
			<div class="grid gap-1.5">
				<Label for="routine-comment">Comment</Label>
				<Input id="routine-comment" bind:value={def.comment} />
			</div>

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={saving} data-testid="routine-save">
					{saving ? 'Saving...' : 'Save'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
