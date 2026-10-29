<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { getNavState } from '#lib/components/navigation/nav-state.svelte.ts';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import {
		FK_ACTIONS,
		buildAddForeignKey,
		buildDropForeignKey,
		validateFkDef,
		type FkAction,
		type FkDef
	} from '#lib/sql/foreign-key.ts';
	import { alterEnhance } from './alter-enhance.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		open: boolean;
		/** Existing constraint being edited (null = add). */
		original: FkDef | null;
		initial: FkDef;
		columns: string[];
		databases: string[];
		db: string;
		table: string;
		/** `/db/x/table/y` */
		base: string;
	}

	let {
		open = $bindable(),
		original,
		initial,
		columns,
		databases,
		db,
		table,
		base
	}: Props = $props();

	const navState = getNavState();
	/* The dialog is mounted per use: `initial` only seeds the form. */
	/* svelte-ignore state_referenced_locally */
	let def = $state<FkDef>(structuredClone($state.snapshot(initial)));
	let busy = $state(false);
	let error = $state('');
	let tables = $state<string[]>([]);
	let refColumns = $state<string[]>([]);

	const problem = $derived(validateFkDef(def));
	const sql = $derived(
		problem
			? ''
			: (original ? buildDropForeignKey(db, table, original.name) + '\n' : '') +
					buildAddForeignKey(db, table, def)
	);
	const actionLabel = (a: FkAction) => (a === '' ? t('(default)') : a);

	async function getJson<T>(params: Record<string, string>): Promise<T | null> {
		try {
			const res = await fetch(`${base}/relation/targets?${new URLSearchParams(params)}`);
			return res.ok ? ((await res.json()) as T) : null;
		} catch {
			return null;
		}
	}

	async function loadTables(refDb: string) {
		tables = refDb ? ((await getJson<{ tables: string[] }>({ db: refDb }))?.tables ?? []) : [];
	}
	async function loadColumns(refDb: string, refTable: string) {
		refColumns =
			refDb && refTable
				? ((await getJson<{ columns: string[] }>({ db: refDb, table: refTable }))?.columns ?? [])
				: [];
	}

	if (def.refDb) {
		void loadTables(def.refDb);
		void loadColumns(def.refDb, def.refTable);
	}

	async function setRefDb(value: string) {
		def.refDb = value;
		def.refTable = '';
		def.refColumns = def.refColumns.map(() => '');
		refColumns = [];
		await loadTables(value);
	}
	async function setRefTable(value: string) {
		def.refTable = value;
		def.refColumns = def.refColumns.map(() => '');
		await loadColumns(def.refDb, value);
	}
	function addPair() {
		def.columns.push('');
		def.refColumns.push('');
	}
	function removePair(i: number) {
		def.columns.splice(i, 1);
		def.refColumns.splice(i, 1);
	}

	const submit = alterEnhance({
		start: () => {
			busy = true;
			error = '';
		},
		fail: (m) => {
			busy = false;
			error = m;
		},
		success: () => {
			busy = false;
			open = false;
			toast.success(
				original
					? t('The foreign key has been modified.')
					: t('The foreign key has been added.')
			);
			if (page.params.db) void navState.load(page.params.db, true);
		}
	}, t);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="fk-editor">
		<Dialog.Header>
			<Dialog.Title>
				{original ? t('Edit foreign key {name}', { name: original.name }) : t('Add foreign key')}
			</Dialog.Title>
			<Dialog.Description>
				{t('The referenced columns must be indexed. Editing drops and re-creates the constraint.')}
			</Dialog.Description>
		</Dialog.Header>

		<form method="POST" action="?/saveFk" class="flex flex-col gap-4" use:enhance={submit}>
			<input
				type="hidden"
				name="payload"
				value={JSON.stringify({ original: original?.name ?? null, def })}
			/>
			<div class="grid gap-4 md:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="fk-name">{t('Constraint name')}</Label>
					<Input
						id="fk-name"
						bind:value={def.name}
						placeholder={t('Constraint name (optional)')}
						maxlength={64}
						autocomplete="off"
						class="font-mono"
					/>
				</div>
				<div></div>
				<div class="flex flex-col gap-1.5">
					<Label id="fk-db-label">{t('Referenced database')}</Label>
					<Select.Root type="single" value={def.refDb} onValueChange={setRefDb}>
						<Select.Trigger class="w-full" aria-labelledby="fk-db-label">
							<span class="truncate font-mono">{def.refDb || t('Choose a database')}</span>
						</Select.Trigger>
						<Select.Content class="max-h-72">
							{#each databases as d (d)}
								<Select.Item value={d} label={d}>{d}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label id="fk-table-label">{t('Referenced table')}</Label>
					<Select.Root
						type="single"
						value={def.refTable}
						onValueChange={setRefTable}
						disabled={def.refDb === ''}
					>
						<Select.Trigger class="w-full" aria-labelledby="fk-table-label">
							<span class="truncate font-mono">{def.refTable || t('Choose a table')}</span>
						</Select.Trigger>
						<Select.Content class="max-h-72">
							{#each tables as tbl (tbl)}
								<Select.Item value={tbl} label={tbl}>{tbl}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label id="fk-del-label">ON DELETE</Label>
					<Select.Root
						type="single"
						value={def.onDelete}
						onValueChange={(v) => (def.onDelete = v as FkAction)}
					>
						<Select.Trigger class="w-full" aria-labelledby="fk-del-label">
							{actionLabel(def.onDelete)}
						</Select.Trigger>
						<Select.Content>
							{#each FK_ACTIONS as a (a)}
								<Select.Item value={a} label={actionLabel(a)}>{actionLabel(a)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label id="fk-upd-label">ON UPDATE</Label>
					<Select.Root
						type="single"
						value={def.onUpdate}
						onValueChange={(v) => (def.onUpdate = v as FkAction)}
					>
						<Select.Trigger class="w-full" aria-labelledby="fk-upd-label">
							{actionLabel(def.onUpdate)}
						</Select.Trigger>
						<Select.Content>
							{#each FK_ACTIONS as a (a)}
								<Select.Item value={a} label={actionLabel(a)}>{actionLabel(a)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			<div class="flex flex-col gap-2" data-testid="fk-pairs">
				<span class="text-sm font-medium">{t('Columns')}</span>
				{#each def.columns as col, i (i)}
					<div class="flex items-center gap-2" role="group" aria-label={t('Column pair {n}', { n: i + 1 })}>
						<Select.Root
							type="single"
							value={def.columns[i]}
							onValueChange={(v) => (def.columns[i] = v)}
						>
							<Select.Trigger class="min-w-0 flex-1" aria-label={t('Column')}>
								<span class="truncate font-mono">{col || t('Column')}</span>
							</Select.Trigger>
							<Select.Content class="max-h-72">
								{#each columns as c (c)}
									<Select.Item value={c} label={c}>{c}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<span class="text-muted-foreground" aria-hidden="true">→</span>
						<Select.Root
							type="single"
							value={def.refColumns[i]}
							onValueChange={(v) => (def.refColumns[i] = v)}
							disabled={def.refTable === ''}
						>
							<Select.Trigger class="min-w-0 flex-1" aria-label={t('Referenced column')}>
								<span class="truncate font-mono">{def.refColumns[i] || t('Referenced column')}</span>
							</Select.Trigger>
							<Select.Content class="max-h-72">
								{#each refColumns as c (c)}
									<Select.Item value={c} label={c}>{c}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={t('Remove column pair {n}', { n: i + 1 })}
							disabled={def.columns.length <= 1}
							onclick={() => removePair(i)}
						>
							<Trash2 />
						</Button>
					</div>
				{/each}
				<Button type="button" variant="outline" size="sm" class="self-start" onclick={addPair}>
					<Plus /> {t('Add column')}
				</Button>
			</div>

			<div>
				<span class="text-sm font-medium">SQL</span>
				<pre
					class="mt-1 max-h-40 overflow-auto rounded-lg border bg-muted p-3 font-mono text-sm whitespace-pre-wrap"
					data-testid="fk-sql">{sql || (problem ? t(problem) : '')}</pre>
			</div>

			{#if error}
				<Alert.Root variant="destructive" role="alert" data-testid="fk-error">
					<Alert.Description>{error}</Alert.Description>
				</Alert.Root>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>{t('Cancel')}</Button>
				<Button type="submit" disabled={busy || problem !== null}>{t('Save')}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
