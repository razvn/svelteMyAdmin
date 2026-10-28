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
		let text = `${affected} row${affected === 1 ? '' : 's'} affected.`;
		if (r.insertId) text += ` Inserted row id: ${r.insertId}.`;
		if (Number(r.skipped) > 0) text += ` ${r.skipped} ignored.`;
		return text;
	}

	const submit: SubmitFunction = ({ cancel }) => {
		if (hasJsonError) {
			cancel();
			result = {
				kind: 'error',
				message: 'Fix the invalid JSON values before saving.',
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
					message: String(data.error ?? 'The statement failed.'),
					statements,
					warnings: []
				};
				return;
			}
			if (res.type !== 'success') {
				result = { kind: 'error', message: 'The request failed.', statements: [], warnings: [] };
				return;
			}
			if (!data.executed) {
				result = {
					kind: data.noChange ? 'nochange' : 'preview',
					message: data.noChange ? 'No change.' : 'Showing SQL query.',
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
					toast.info('There is no next row.');
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
	aria-label={mode === 'edit' ? 'Edit rows' : 'Insert rows'}
>
	<input type="hidden" name="rows" value={rows.length} />
	<div class="flex flex-wrap items-center gap-2 text-sm">
		<span class="text-muted-foreground">Show</span>
		<Button
			type="button"
			size="sm"
			variant={showFunctions ? 'secondary' : 'outline'}
			aria-pressed={showFunctions}
			onclick={() => (showFunctions = !showFunctions)}>Function</Button
		>
		<Button
			type="button"
			size="sm"
			variant={showTypes ? 'secondary' : 'outline'}
			aria-pressed={showTypes}
			onclick={() => (showTypes = !showTypes)}>Type</Button
		>
	</div>

	{#each rows as row, r (r)}
		<Card.Root class="gap-0 py-0" data-testid="insert-row-{r}">
			<Card.Header class="flex flex-row items-center justify-between border-b py-3">
				<Card.Title class="text-base">
					{#if mode === 'edit'}Edit{:else if mode === 'copy'}Copy of{:else}Row{/if}
					{rows.length > 1 || mode !== 'insert' ? r + 1 : ''}
				</Card.Title>
				{#if mode === 'insert' && r > 0}
					<div class="flex items-center gap-2">
						<Checkbox
							id="ignore-{r}"
							checked={ignored[r]}
							onCheckedChange={(on) => (ignored[r] = on === true)}
							aria-label="Ignore row {r + 1}"
						/>
						{#if ignored[r]}<input type="hidden" name="ignore_{r}" value="1" />{/if}
						<Label for="ignore-{r}" class="font-normal">Ignore</Label>
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
							<Table.Head>Column</Table.Head>
							{#if showTypes}<Table.Head>Type</Table.Head>{/if}
							{#if showFunctions}<Table.Head>Function</Table.Head>{/if}
							<Table.Head>Null</Table.Head>
							<Table.Head>Value</Table.Head>
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
									{#if column.generated}<Badge variant="muted" class="ms-1">generated</Badge>{/if}
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
													aria-label="Function for {column.name}"
													size="sm"
													class="w-36"
												>
													<NativeSelectOption value=""></NativeSelectOption>
													{#each functionLists[c] as group (group.label)}
														<NativeSelectOptGroup label={group.label}>
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
														placeholder="salt"
														aria-label="Salt for {column.name}"
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
											aria-label="Null {column.name}"
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
		<Card.Content class="flex flex-wrap items-end gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="submit-type">Action</Label>
				<NativeSelect
					id="submit-type"
					name="submit_type"
					bind:value={submitType}
					aria-label="Action"
				>
					<NativeSelectOption value="save">{editing ? 'Save' : 'Insert'}</NativeSelectOption>
					{#if editing}
						<NativeSelectOption value="insert">Insert as new row</NativeSelectOption>
					{/if}
					<NativeSelectOption value="insertignore">
						{editing ? 'Insert as new row and ignore errors' : 'Insert and ignore errors'}
					</NativeSelectOption>
					<NativeSelectOption value="showinsert">Show insert query</NativeSelectOption>
				</NativeSelect>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="after-insert">After saving</Label>
				<NativeSelect
					id="after-insert"
					name="after_insert"
					bind:value={afterInsert}
					aria-label="After saving"
				>
					<NativeSelectOption value="back">Go back to previous page</NativeSelectOption>
					<NativeSelectOption value="new_insert">Insert another new row</NativeSelectOption>
					<NativeSelectOption value="same_insert">Go back to this page</NativeSelectOption>
					{#if editing}
						<NativeSelectOption value="edit_next">Edit next row</NativeSelectOption>
					{/if}
				</NativeSelect>
			</div>
			<Button type="submit" disabled={busy || hasJsonError}>
				{busy ? 'Saving...' : 'Go'}
			</Button>
			{#if mode === 'insert'}
				<div class="ms-auto flex items-end gap-2">
					<div class="flex flex-col gap-1.5">
						<Label for="row-count">Continue insertion with rows</Label>
						<Input
							id="row-count"
							type="number"
							min="1"
							max="100"
							bind:value={rowCount}
							class="w-24"
						/>
					</div>
					<Button type="button" variant="outline" onclick={setRowCount}>Apply</Button>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</form>
