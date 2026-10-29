<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- targets are server-built app URLs (signed insert links) or a validated same-app goto */
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import {
		NativeSelect,
		NativeSelectOptGroup,
		NativeSelectOption
	} from '#lib/components/ui/native-select/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import {
		blankCell,
		functionGroups,
		jsonError,
		type FormCell,
		type FormColumn,
		type InputSettings
	} from '#lib/sql/insert-edit.ts';
	import InsertValueInput from './insert-value-input.svelte';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t, tn } = useI18n();

	export interface FormRowData {
		cells: FormCell[];
		sizes: (number | null)[];
		where?: string;
		sig?: string;
		source?: { where: string; sig: string };
	}

	export interface SaveResult {
		kind: 'success' | 'error' | 'preview' | 'nochange';
		message: string;
		statements: string[];
		warnings: string[];
	}

	interface Props {
		columns: FormColumn[];
		rows: FormRowData[];
		mode: 'insert' | 'edit' | 'copy';
		after: 'back' | 'new_insert' | 'same_insert' | 'edit_next';
		gotoUrl: string;
		settings: InputSettings & {
			insertRows: number;
			showFunctionFields: boolean;
			showFieldTypes: boolean;
		};
		result: SaveResult | null;
	}

	let {
		columns,
		rows: initial,
		mode,
		after,
		gotoUrl,
		settings,
		// eslint-disable-next-line no-useless-assignment
		result = $bindable(null)
	}: Props = $props();

	const editing = $derived(mode === 'edit');
	let rows = $state<FormRowData[]>(
		untrack(() => initial.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) })))
	);
	// extra blank rows start as "ignored" (phpMyAdmin), the first row never is
	let ignored = $state<boolean[]>(untrack(() => rows.map((_, i) => mode === 'insert' && i > 0)));
	let showFunctions = $state(untrack(() => settings.showFunctionFields));
	let showTypes = $state(untrack(() => settings.showFieldTypes));
	let afterInsert = $state(untrack(() => after));
	let submitType = $state('save');
	let rowCount = $state(untrack(() => rows.length));
	let busy = $state(false);

	const functionLists = $derived(columns.map((c) => functionGroups(c)));
	const hasJsonError = $derived(
		rows.some((r) => r.cells.some((cell, i) => jsonError(columns[i], cell) !== null))
	);
	const SALTED = ['AES_ENCRYPT', 'AES_DECRYPT', 'DES_ENCRYPT', 'DES_DECRYPT', 'ENCRYPT'];

	function setRowCount() {
		const n = Math.min(Math.max(Math.trunc(rowCount) || 1, 1), 100);
		while (rows.length < n) {
			rows.push({
				cells: columns.map((c) => blankCell(c, { func: c.defaultFunction, now: new Date() })),
				sizes: columns.map(() => null)
			});
			ignored.push(true);
		}
		rows.length = n;
		ignored.length = n;
	}

	function summary(r: Record<string, unknown>): string {
		const affected = Number(r.affectedRows ?? 0);
		let text = tn('{n} row affected.', '{n} rows affected.', affected);
		if (r.insertId) text += ' ' + t('Inserted row id: {id}.', { id: String(r.insertId) });
		if (Number(r.skipped) > 0) text += ' ' + t('{n} ignored.', { n: Number(r.skipped) });
		return text;
	}

	const submit: SubmitFunction = ({ cancel }) => {
		if (hasJsonError) {
			cancel();
			result = {
				kind: 'error',
				message: t('Fix the invalid JSON values before saving.'),
				statements: [],
				warnings: []
			};
			return;
		}
		busy = true;
		return async ({ result: res }) => {
			busy = false;
			const data = (res.type === 'success' || res.type === 'failure' ? res.data : null) ?? {};
			const statements = (data.statements as string[] | undefined) ?? [];
			if (res.type === 'failure') {
				result = {
					kind: 'error',
					message: String(data.error ?? t('The statement failed.')),
					statements,
					warnings: []
				};
				return;
			}
			if (res.type !== 'success') {
				result = { kind: 'error', message: t('The request failed.'), statements: [], warnings: [] };
				return;
			}
			if (!data.executed) {
				result = {
					kind: data.noChange ? 'nochange' : 'preview',
					message: data.noChange ? t('No change.') : t('Showing SQL query.'),
					statements,
					warnings: []
				};
				return;
			}
			const text = summary(data);
			result = {
				kind: 'success',
				message: text,
				statements,
				warnings: (data.warnings as string[]) ?? []
			};
			const choice = data.after as string;
			if (choice === 'new_insert') {
				await goto(String(data.newUrl), { refreshAll: true });
			} else if (choice === 'same_insert') {
				await goto(String(data.sameUrl), { refreshAll: true });
			} else if (choice === 'edit_next') {
				if (data.next) {
					await goto(String(data.next), { refreshAll: true });
				} else {
					toast.info(t('There is no next row.'));
					await goto(gotoUrl);
				}
			} else {
				toast.success(text);
				await goto(gotoUrl);
			}
		};
	};
</script>

<form
	method="POST"
	enctype="multipart/form-data"
	use:enhance={submit}
	class="flex flex-col gap-4"
	aria-label={mode === 'edit' ? t('Edit rows') : t('Insert rows')}
>
	<input type="hidden" name="rows" value={rows.length} />
	<div class="flex flex-wrap items-center gap-2 text-sm">
		<span class="text-muted-foreground">{t('Show')}</span>
		<Button
			type="button"
			size="sm"
			variant={showFunctions ? 'secondary' : 'outline'}
			aria-pressed={showFunctions}
			onclick={() => (showFunctions = !showFunctions)}>{t('Function')}</Button
		>
		<Button
			type="button"
			size="sm"
			variant={showTypes ? 'secondary' : 'outline'}
			aria-pressed={showTypes}
			onclick={() => (showTypes = !showTypes)}>{t('Type')}</Button
		>
	</div>

	{#each rows as row, r (r)}
		<Card.Root class="gap-0 py-0" data-testid="insert-row-{r}">
			<Card.Header class="flex flex-row items-center justify-between border-b py-3">
				<Card.Title class="text-base">
					{#if mode === 'edit'}{t('Edit')}{:else if mode === 'copy'}{t('Copy of')}{:else}{t(
							'Row'
						)}{/if}
					{rows.length > 1 || mode !== 'insert' ? r + 1 : ''}
				</Card.Title>
				{#if mode === 'insert' && r > 0}
					<div class="flex items-center gap-2">
						<Checkbox
							id="ignore-{r}"
							checked={ignored[r]}
							onCheckedChange={(on) => (ignored[r] = on === true)}
							aria-label={t('Ignore row {n}', { n: r + 1 })}
						/>
						{#if ignored[r]}<input type="hidden" name="ignore_{r}" value="1" />{/if}
						<Label for="ignore-{r}" class="font-normal">{t('Ignore')}</Label>
					</div>
				{/if}
			</Card.Header>
			{#if row.where}
				<input type="hidden" name="where_{r}" value={row.where} />
				<input type="hidden" name="sig_{r}" value={row.sig} />
			{/if}
			{#if row.source}
				<input type="hidden" name="src_{r}" value={row.source.where} />
				<input type="hidden" name="srcsig_{r}" value={row.source.sig} />
			{/if}
			<Card.Content
				class="px-0"
				oninput={() => {
					if (mode === 'insert' && r > 0) ignored[r] = false;
				}}
			>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{t('Column')}</Table.Head>
							{#if showTypes}<Table.Head>{t('Type')}</Table.Head>{/if}
							{#if showFunctions}<Table.Head>{t('Function')}</Table.Head>{/if}
							<Table.Head>{t('Null')}</Table.Head>
							<Table.Head>{t('Value')}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each columns as column, c (column.name)}
							{@const cell = row.cells[c]}
							<Table.Row data-column={column.name}>
								<Table.Cell class="font-medium whitespace-normal" title={column.comment}>
									{column.name}
									{#if column.key === 'PRI'}<Badge variant="muted" class="ms-1">PRI</Badge>{/if}
									{#if column.autoIncrement}
										<Badge variant="info" class="ms-1">auto_increment</Badge>
									{/if}
									{#if column.generated}<Badge variant="muted" class="ms-1">{t('generated')}</Badge
										>{/if}
								</Table.Cell>
								{#if showTypes}
									<Table.Cell class="font-mono text-xs text-muted-foreground">
										{column.type}
									</Table.Cell>
								{/if}
								{#if showFunctions}
									<Table.Cell class="whitespace-normal">
										{#if !column.protected && !column.generated}
											<div class="flex items-center gap-1">
												<NativeSelect
													name="f_{r}_{c}"
													bind:value={cell.func}
													aria-label={t('Function for {name}', { name: column.name })}
													size="sm"
													class="w-36"
												>
													<NativeSelectOption value=""></NativeSelectOption>
													{#each functionLists[c] as group (group.label)}
														<NativeSelectOptGroup label={t(group.label)}>
															{#each group.functions as fn (fn)}
																<NativeSelectOption value={fn}>{fn}</NativeSelectOption>
															{/each}
														</NativeSelectOptGroup>
													{/each}
												</NativeSelect>
												{#if SALTED.includes(cell.func)}
													<Input
														name="s_{r}_{c}"
														bind:value={cell.salt}
														placeholder={t('salt')}
														aria-label={t('Salt for {name}', { name: column.name })}
														class="h-8 w-24"
													/>
												{/if}
											</div>
										{/if}
									</Table.Cell>
								{/if}
								<Table.Cell>
									{#if column.nullable && !column.generated}
										<Checkbox
											checked={cell.isNull}
											onCheckedChange={(on) => (cell.isNull = on === true)}
											aria-label={t('Null {name}', { name: column.name })}
										/>
										{#if cell.isNull}<input type="hidden" name="n_{r}_{c}" value="1" />{/if}
									{/if}
								</Table.Cell>
								<Table.Cell class="whitespace-normal">
									{#if column.generated}
										<span class="font-mono text-sm text-muted-foreground">
											{cell.isNull ? 'NULL' : cell.value}
										</span>
									{:else}
										<InsertValueInput
											{column}
											bind:cell={row.cells[c]}
											name="v_{r}_{c}"
											fileName="u_{r}_{c}"
											{settings}
											size={row.sizes[c]}
										/>
									{/if}
									{#if cell.prev !== undefined}
										<input type="hidden" name="p_{r}_{c}" value={cell.prev} />
										{#if cell.prevNull}<input type="hidden" name="pn_{r}_{c}" value="1" />{/if}
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/each}

	<Card.Root>
		<Card.Content class="flex flex-col gap-4 lg:flex-row lg:items-end" data-testid="insert-footer">
			<div class="grid gap-4 lg:flex">
				<div class="flex flex-col gap-1.5">
					<Label for="submit-type">{t('Action')}</Label>
					<NativeSelect
						id="submit-type"
						name="submit_type"
						bind:value={submitType}
						aria-label={t('Action')}
						class="w-full lg:w-60"
					>
						<NativeSelectOption value="save">
							{editing ? t('Save') : t('Insert')}
						</NativeSelectOption>
						{#if editing}
							<NativeSelectOption value="insert">{t('Insert as new row')}</NativeSelectOption>
						{/if}
						<NativeSelectOption value="insertignore">
							{editing ? t('Insert as new row and ignore errors') : t('Insert and ignore errors')}
						</NativeSelectOption>
						<NativeSelectOption value="showinsert">{t('Show insert query')}</NativeSelectOption>
					</NativeSelect>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="after-insert">{t('After saving')}</Label>
					<NativeSelect
						id="after-insert"
						name="after_insert"
						bind:value={afterInsert}
						aria-label={t('After saving')}
						class="w-full lg:w-72"
					>
						<NativeSelectOption value="back">{t('Go back to previous page')}</NativeSelectOption>
						<NativeSelectOption value="new_insert">
							{t('Insert another new row')}
						</NativeSelectOption>
						<NativeSelectOption value="same_insert">{t('Go back to this page')}</NativeSelectOption>
						{#if editing}
							<NativeSelectOption value="edit_next">{t('Edit next row')}</NativeSelectOption>
						{/if}
					</NativeSelect>
				</div>
			</div>
			{#if mode === 'insert'}
				<div class="flex items-end gap-2 border-t pt-4 lg:border-s lg:border-t-0 lg:ps-4 lg:pt-0">
					<div class="flex flex-1 flex-col gap-1.5 lg:flex-none">
						<Label for="row-count">{t('Continue insertion with rows')}</Label>
						<Input
							id="row-count"
							type="number"
							min="1"
							max="100"
							bind:value={rowCount}
							class="w-full"
						/>
					</div>
					<Button type="button" variant="outline" onclick={setRowCount}>{t('Apply')}</Button>
				</div>
			{/if}
			<Button type="submit" class="w-full lg:ms-auto lg:w-auto" disabled={busy || hasJsonError}>
				{busy ? t('Saving...') : t('Go')}
			</Button>
		</Card.Content>
	</Card.Root>
</form>
