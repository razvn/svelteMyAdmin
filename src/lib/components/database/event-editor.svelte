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
	import SqlEditor from '#lib/components/sql-editor/sql-editor.svelte';
	import SelectField from './select-field.svelte';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

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
			errors = res.data?.errors ?? [res.message ?? t('Saving the event failed.')];
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] overflow-y-auto sm:max-w-2xl" data-testid="event-editor">
		<Dialog.Header>
			<Dialog.Title
				>{original ? t('Edit event {name}', { name: original }) : t('Add event')}</Dialog.Title
			>
			<Dialog.Description>
				{t('Editing drops and re-creates the event; the original is restored if creation fails.')}
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
					<Label for="event-name">{t('Event name')}</Label>
					<Input id="event-name" bind:value={def.name} autocomplete="off" />
				</div>
				<div class="grid gap-1.5">
					<Label>{t('Status')}</Label>
					<SelectField label={t('Status')} bind:value={def.status} options={EVENT_STATUSES} />
				</div>
				<div class="grid gap-1.5">
					<Label>{t('Event type')}</Label>
					<SelectField label={t('Event type')} bind:value={def.type} options={EVENT_TYPES} />
				</div>
				{#if def.type === 'ONE TIME'}
					<div class="grid gap-1.5">
						<Label for="event-execute-at">{t('Execute at')}</Label>
						<Input
							id="event-execute-at"
							placeholder="YYYY-MM-DD HH:MM:SS"
							bind:value={def.executeAt}
						/>
					</div>
				{:else}
					<div class="grid gap-1.5">
						<Label for="event-interval-value">{t('Execute every')}</Label>
						<div class="flex gap-2">
							<Input id="event-interval-value" class="w-24" bind:value={def.intervalValue} />
							<SelectField
								label={t('Interval field')}
								bind:value={def.intervalField}
								options={EVENT_INTERVALS}
							/>
						</div>
					</div>
					<div class="grid gap-1.5">
						<Label for="event-starts">{t('Start')}</Label>
						<Input id="event-starts" placeholder="YYYY-MM-DD HH:MM:SS" bind:value={def.starts} />
					</div>
					<div class="grid gap-1.5">
						<Label for="event-ends">{t('End')}</Label>
						<Input id="event-ends" placeholder="YYYY-MM-DD HH:MM:SS" bind:value={def.ends} />
					</div>
				{/if}
			</div>
			<div class="grid gap-1.5">
				<Label>{t('Definition')}</Label>
				<SqlEditor
					id="event-definition"
					aria-label={t('Definition')}
					minLines={6}
					bind:value={def.definition}
				/>
			</div>
			<div class="flex items-center gap-2">
				<Checkbox id="event-preserve" bind:checked={def.preserve} />
				<Label for="event-preserve">{t('On completion preserve')}</Label>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="grid gap-1.5">
					<Label for="event-definer">{t('Definer (user@host)')}</Label>
					<Input id="event-definer" bind:value={def.definer} placeholder="root@localhost" />
				</div>
				<div class="grid gap-1.5">
					<Label for="event-comment">{t('Comment')}</Label>
					<Input id="event-comment" bind:value={def.comment} />
				</div>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>{t('Cancel')}</Button
				>
				<Button type="submit" disabled={saving} data-testid="event-save">
					{saving ? t('Saving...') : t('Save')}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
