<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import * as NativeSelect from '#lib/components/ui/native-select/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import {
		buildCreateView,
		VIEW_ALGORITHMS,
		VIEW_CHECK_OPTIONS,
		VIEW_SECURITY,
		type CreateViewForm
	} from '#lib/sql/create-view.ts';
	import { errorMessage } from '#lib/sql/messages.ts';
	import type { ScriptResult } from '#lib/sql/run-types.ts';

	interface Props {
		open: boolean;
		/** Database the view is created in. */
		db: string;
		/** Prefilled `AS` query. */
		query: string;
		oncreated?: (name: string) => void;
	}

	let { open = $bindable(), db, query, oncreated }: Props = $props();

	const { t } = useI18n();
	let name = $state('');
	let orReplace = $state(false);
	let algorithm = $state<CreateViewForm['algorithm']>('UNDEFINED');
	let definer = $state('');
	let sqlSecurity = $state<CreateViewForm['sqlSecurity']>('');
	let columnNames = $state('');
	let withCheck = $state<CreateViewForm['withCheck']>('');
	// Edited text; null = follow the statement's query.
	let edited = $state<string | null>(null);
	let busy = $state(false);
	let error = $state('');

	const as = $derived(edited ?? query.replace(/;+\s*$/, ''));
	const form = $derived({
		name,
		orReplace,
		algorithm,
		definer,
		sqlSecurity,
		columnNames,
		as,
		withCheck
	});
	const built = $derived(buildCreateView(form));
	// The preview shows a placeholder until a name is typed.
	const preview = $derived(buildCreateView({ ...form, name: name.trim() || 'view_name' }));

	async function submit() {
		error = '';
		if (built.error !== null) {
			// msgids marked with N_() in #lib/sql/create-view.ts (table catalog)
			error = t(built.error); // i18n-ignore
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/sql/run', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sql: built.sql, db })
			});
			if (!res.ok) {
				error = t('The view could not be created.');
				return;
			}
			const result = (await res.json()) as ScriptResult;
			const stmt = result.statements[0];
			if (!stmt || !stmt.ok) {
				error = stmt ? errorMessage(stmt.error.errno, stmt.error.message) : t('No result.');
				return;
			}
			open = false;
			oncreated?.(name.trim());
		} catch {
			error = t('The view could not be created.');
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] overflow-auto sm:max-w-2xl" data-testid="create-view-dialog">
		<Dialog.Header>
			<Dialog.Title>{t('Create view')}</Dialog.Title>
			<Dialog.Description
				>{t('Create a view in database {db} from this query.', { db })}</Dialog.Description
			>
		</Dialog.Header>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="view-name">{t('VIEW name')}</Label>
				<Input id="view-name" bind:value={name} maxlength={64} placeholder={t('View name')} />
			</div>
			<div class="flex items-end gap-2 pb-2">
				<Checkbox id="view-or-replace" bind:checked={orReplace} />
				<Label for="view-or-replace">OR REPLACE</Label>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="view-algorithm">ALGORITHM</Label>
				<NativeSelect.Root id="view-algorithm" class="w-full" bind:value={algorithm}>
					{#each VIEW_ALGORITHMS as a (a)}
						<NativeSelect.Option value={a}>{a}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="view-security">SQL SECURITY</Label>
				<NativeSelect.Root id="view-security" class="w-full" bind:value={sqlSecurity}>
					<NativeSelect.Option value="">{t('(default)')}</NativeSelect.Option>
					{#each VIEW_SECURITY as a (a)}
						<NativeSelect.Option value={a}>{a}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="view-definer">{t('Definer')}</Label>
				<Input id="view-definer" bind:value={definer} maxlength={100} placeholder="user@host" />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="view-check">WITH CHECK OPTION</Label>
				<NativeSelect.Root id="view-check" class="w-full" bind:value={withCheck}>
					<NativeSelect.Option value="">{t('(none)')}</NativeSelect.Option>
					{#each VIEW_CHECK_OPTIONS as a (a)}
						<NativeSelect.Option value={a}>{a}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>
			<div class="flex flex-col gap-1.5 sm:col-span-2">
				<Label for="view-columns">{t('Column names')}</Label>
				<Input
					id="view-columns"
					bind:value={columnNames}
					maxlength={100}
					placeholder={t('comma separated, optional')}
				/>
			</div>
			<div class="flex flex-col gap-1.5 sm:col-span-2">
				<Label for="view-as">AS</Label>
				<Textarea
					id="view-as"
					class="min-h-28 font-mono text-xs"
					value={as}
					oninput={(e) => (edited = e.currentTarget.value)}
				/>
			</div>
		</div>

		{#if preview.error === null}
			<pre
				class="max-h-32 overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
				data-testid="create-view-sql">{preview.sql}</pre>
		{/if}
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}

		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (open = false)}>{t('Cancel')}</Button>
			<Button type="button" disabled={busy} onclick={submit}>{t('Create')}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
