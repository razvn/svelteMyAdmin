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
	import SqlEditor from '#lib/components/sql-editor/sql-editor.svelte';
	import SelectField from './select-field.svelte';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

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
			errors = res.data?.errors ?? [res.message ?? t('Saving the routine failed.')];
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-testid="routine-editor">
		<Dialog.Header>
			<Dialog.Title
				>{original
					? original.type === 'PROCEDURE'
						? t('Edit procedure')
						: t('Edit function')
					: t('Add routine')}</Dialog.Title
			>
			<Dialog.Description>
				{t('Editing drops and re-creates the routine; the original is restored if creation fails.')}
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
					<Label for="routine-name">{t('Routine name')}</Label>
					<Input id="routine-name" bind:value={def.name} autocomplete="off" />
				</div>
				<div class="grid gap-1.5">
					<Label id="routine-type-label">{t('Type')}</Label>
					<SelectField
						label={t('Type')}
						bind:value={def.type}
						options={ROUTINE_TYPES}
						testid="routine-type"
					/>
				</div>
			</div>

			<fieldset class="grid gap-2">
				<legend class="mb-1 text-sm font-medium">{t('Parameters')}</legend>
				{#each def.params as param, i (i)}
					<div
						class="grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[6rem_1fr_8rem_6rem_9rem_auto]"
						data-testid="routine-param"
					>
						{#if def.type === 'PROCEDURE'}
							<SelectField
								label={t('Direction of parameter {n}', { n: i + 1 })}
								bind:value={param.direction}
								options={PARAM_DIRECTIONS}
								class="w-full"
							/>
						{:else}
							<span class="text-sm text-muted-foreground">IN</span>
						{/if}
						<Input
							placeholder={t('Name')}
							aria-label={t('Name of parameter {n}', { n: i + 1 })}
							bind:value={param.name}
						/>
						<SelectField
							label={t('Type of parameter {n}', { n: i + 1 })}
							bind:value={param.type}
							options={ROUTINE_DATA_TYPES}
						/>
						<Input
							placeholder={t('Length')}
							aria-label={t('Length of parameter {n}', { n: i + 1 })}
							bind:value={param.length}
						/>
						{#if optionsKind(param.type) === 'numeric'}
							<SelectField
								label={t('Options of parameter {n}', { n: i + 1 })}
								bind:value={param.opts}
								options={NUMERIC_OPTIONS}
								emptyLabel={t('(none)')}
							/>
						{:else if optionsKind(param.type) === 'charset'}
							<Input
								placeholder={t('Charset')}
								aria-label={t('Charset of parameter {n}', { n: i + 1 })}
								bind:value={param.opts}
							/>
						{:else}
							<span></span>
						{/if}
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={t('Remove parameter {n}', { n: i + 1 })}
							onclick={() => def.params.splice(i, 1)}
						>
							<Trash2 />
						</Button>
					</div>
				{/each}
				<div>
					<Button type="button" variant="outline" size="sm" onclick={addParam}>
						<Plus /> {t('Add parameter')}
					</Button>
				</div>
			</fieldset>

			{#if def.type === 'FUNCTION'}
				<div class="grid gap-2 sm:grid-cols-3">
					<div class="grid gap-1.5">
						<Label>{t('Return type')}</Label>
						<SelectField
							label={t('Return type')}
							bind:value={def.returns.type}
							options={ROUTINE_DATA_TYPES}
						/>
					</div>
					<div class="grid gap-1.5">
						<Label for="routine-return-length">{t('Return length/values')}</Label>
						<Input id="routine-return-length" bind:value={def.returns.length} />
					</div>
					<div class="grid gap-1.5">
						<Label for="routine-return-opts">{t('Return options')}</Label>
						{#if optionsKind(def.returns.type) === 'numeric'}
							<SelectField
								label={t('Return options')}
								bind:value={def.returns.opts}
								options={NUMERIC_OPTIONS}
								emptyLabel={t('(none)')}
							/>
						{:else if optionsKind(def.returns.type) === 'charset'}
							<Input id="routine-return-opts" placeholder={t('Charset')} bind:value={def.returns.opts} />
						{:else}
							<Input id="routine-return-opts" disabled />
						{/if}
					</div>
				</div>
			{/if}

			<div class="grid gap-1.5">
				<Label>{t('Definition')}</Label>
				<SqlEditor
					id="routine-definition"
					aria-label={t('Definition')}
					minLines={8}
					bind:value={def.definition}
				/>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex items-center gap-2">
					<Checkbox id="routine-deterministic" bind:checked={def.deterministic} />
					<Label for="routine-deterministic">{t('Is deterministic')}</Label>
				</div>
				<div class="grid gap-1.5">
					<Label for="routine-definer">{t('Definer (user@host)')}</Label>
					<Input id="routine-definer" bind:value={def.definer} placeholder="root@localhost" />
				</div>
				<div class="grid gap-1.5">
					<Label>{t('Security type')}</Label>
					<SelectField
						label={t('Security type')}
						bind:value={def.securityType}
						options={SECURITY_TYPES}
						emptyLabel={t('(default)')}
					/>
				</div>
				<div class="grid gap-1.5">
					<Label>{t('SQL data access')}</Label>
					<SelectField
						label={t('SQL data access')}
						bind:value={def.sqlDataAccess}
						options={SQL_DATA_ACCESS}
						emptyLabel={t('(default)')}
					/>
				</div>
			</div>
			<div class="grid gap-1.5">
				<Label for="routine-comment">{t('Comment')}</Label>
				<Input id="routine-comment" bind:value={def.comment} />
			</div>

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>{t('Cancel')}</Button>
				<Button type="submit" disabled={saving} data-testid="routine-save">
					{saving ? t('Saving...') : t('Save')}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
