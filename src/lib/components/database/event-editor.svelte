<script lang="ts">
	import { page } from '$app/state';
	import { callAction } from '#lib/forms/call-action.ts';
	import { EVENT_INTERVALS, EVENT_STATUSES, EVENT_TYPES } from '#lib/sql/event-types.ts';
	import type { EventDef } from '#lib/sql/event.ts';
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
		def: EventDef;
		/** Name of the event being edited, or null when adding. */
		original: string | null;
		onsaved: (name: string) => void;
	}

	let { open = $bindable(), def = $bindable(), original, onsaved }: Props = $props();

	let errors = $state<string[]>([]);
	let saving = $state(false);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		errors = [];
		const res = await callAction<{ errors?: string[] }>(page.url.pathname, 'save', {
			payload: JSON.stringify($state.snapshot(def)),
			original: original ?? ''
		});
		saving = false;
		if (res.ok) {
			open = false;
			onsaved(def.name);
		} else {
			errors = res.data?.errors ?? [res.message ?? 'Saving the event failed.'];
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] overflow-y-auto sm:max-w-2xl" data-testid="event-editor">
		<Dialog.Header>
			<Dialog.Title>{original ? `Edit event ${original}` : 'Add event'}</Dialog.Title>
			<Dialog.Description>
				Editing drops and re-creates the event; the original is restored if creation fails.
			</Dialog.Description>
		</Dialog.Header>

		<form class="grid gap-4" onsubmit={save}>
			{#if errors.length > 0}
				<Alert.Root variant="destructive" data-testid="event-errors">
					<ul class="list-inside list-disc">
						{#each errors as message (message)}<li>{message}</li>{/each}
					</ul>
				</Alert.Root>
			{/if}
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="grid gap-1.5">
					<Label for="event-name">Event name</Label>
					<Input id="event-name" bind:value={def.name} autocomplete="off" />
				</div>
				<div class="grid gap-1.5">
					<Label>Status</Label>
					<SelectField label="Status" bind:value={def.status} options={EVENT_STATUSES} />
				</div>
				<div class="grid gap-1.5">
					<Label>Event type</Label>
					<SelectField label="Event type" bind:value={def.type} options={EVENT_TYPES} />
				</div>
				{#if def.type === 'ONE TIME'}
					<div class="grid gap-1.5">
						<Label for="event-execute-at">Execute at</Label>
						<Input
							id="event-execute-at"
							placeholder="YYYY-MM-DD HH:MM:SS"
							bind:value={def.executeAt}
						/>
					</div>
				{:else}
					<div class="grid gap-1.5">
						<Label for="event-interval-value">Execute every</Label>
						<div class="flex gap-2">
							<Input id="event-interval-value" class="w-24" bind:value={def.intervalValue} />
							<SelectField
								label="Interval field"
								bind:value={def.intervalField}
								options={EVENT_INTERVALS}
							/>
						</div>
					</div>
					<div class="grid gap-1.5">
						<Label for="event-starts">Start</Label>
						<Input id="event-starts" placeholder="YYYY-MM-DD HH:MM:SS" bind:value={def.starts} />
					</div>
					<div class="grid gap-1.5">
						<Label for="event-ends">End</Label>
						<Input id="event-ends" placeholder="YYYY-MM-DD HH:MM:SS" bind:value={def.ends} />
					</div>
				{/if}
			</div>
			<div class="grid gap-1.5">
				<Label for="event-definition">Definition</Label>
				<Textarea
					id="event-definition"
					class="min-h-32 font-mono text-[13px]"
					spellcheck={false}
					bind:value={def.definition}
				/>
			</div>
			<div class="flex items-center gap-2">
				<Checkbox id="event-preserve" bind:checked={def.preserve} />
				<Label for="event-preserve">On completion preserve</Label>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="grid gap-1.5">
					<Label for="event-definer">Definer (user@host)</Label>
					<Input id="event-definer" bind:value={def.definer} placeholder="root@localhost" />
				</div>
				<div class="grid gap-1.5">
					<Label for="event-comment">Comment</Label>
					<Input id="event-comment" bind:value={def.comment} />
				</div>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={saving} data-testid="event-save">
					{saving ? 'Saving...' : 'Save'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
