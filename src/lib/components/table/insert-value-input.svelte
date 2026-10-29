<script lang="ts">
	import Calendar from '@lucide/svelte/icons/calendar';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import {
		jsonError,
		type FormCell,
		type FormColumn,
		type InputSettings
	} from '#lib/sql/insert-edit.ts';
	import SqlEditor from '#lib/components/sql-editor/sql-editor.svelte';
	import GisEditorDialog from '#lib/gis/gis-editor-dialog.svelte';
	import FkSelect from './fk-select.svelte';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		column: FormColumn;
		cell: FormCell;
		/** Form field name of the value (`v_<row>_<col>`). */
		name: string;
		/** Form field name of the file input. */
		fileName: string;
		settings: InputSettings;
		/** Stored size of a protected binary value (edit mode). */
		size?: number | null;
	}

	let { column, cell = $bindable(), name, fileName, settings, size = null }: Props = $props();

	const disabled = $derived(cell.isNull);
	const error = $derived(jsonError(column, cell));
	const label = $derived(t('Value of {name}', { name: column.name }));
	const kind = $derived(column.kind);
	const isDateLike = $derived(
		kind === 'date' || kind === 'datetime' || kind === 'timestamp' || kind === 'time'
	);
	const inputType = $derived(
		kind === 'date' ? 'date' : kind === 'time' ? 'time' : 'datetime-local'
	);
	const scale = $derived(Number(/,\s*(\d+)\)/.exec(column.type)?.[1] ?? 0));
	const step = $derived(
		kind === 'int' ? '1' : kind === 'decimal' && scale > 0 ? `0.${'0'.repeat(scale - 1)}1` : 'any'
	);
	const textRows = $derived(
		kind === 'text' && settings.longtextDoubleTextarea && column.trueType === 'longtext'
			? settings.textareaRows * 2
			: settings.textareaRows
	);
	const textCols = $derived(
		kind === 'text' && settings.longtextDoubleTextarea && column.trueType === 'longtext'
			? settings.textareaCols * 2
			: settings.textareaCols
	);
	const sizeAttr = $derived(Math.min(Math.max((column.length || 20) * 2, 4), settings.limitChars));

	let picker = $state<HTMLInputElement | null>(null);
	let gisOpen = $state(false);

	function pickerValue(): string {
		const v = cell.value.trim();
		if (kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
		if (kind === 'time') return /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v) ? v : '';
		const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)/.exec(v);
		return m ? `${m[1]}T${m[2]}` : '';
	}

	function fromPicker(v: string) {
		if (v !== '') cell.value = v.replace('T', ' ');
	}

	function toggleSet(member: string, on: boolean) {
		const next = cell.setValues.filter((v) => v !== member);
		cell.setValues = on ? column.enumValues.filter((v) => v === member || next.includes(v)) : next;
	}
</script>

{#if column.inputTransform && !column.protected && column.inputTransform.widget !== 'default'}
	{@const widget = column.inputTransform.widget}
	{#if widget === 'text'}
		<Input
			{name}
			bind:value={cell.value}
			{disabled}
			aria-label={label}
			autocomplete="off"
			spellcheck={false}
			class="max-w-md font-mono"
			data-transform={column.inputTransform.id}
		/>
	{:else if widget === 'file' || widget === 'image'}
		<div
			class="flex flex-wrap items-center gap-2 text-sm"
			data-transform={column.inputTransform.id}
		>
			{#if cell.value !== ''}<input type="hidden" {name} value={cell.value} />{/if}
			<input
				type="file"
				name={fileName}
				{disabled}
				accept={widget === 'image' ? 'image/*' : undefined}
				aria-label={t('Upload {name}', { name: column.name })}
				class="text-xs"
			/>
		</div>
	{:else if column.inputTransform.language === 'sql'}
		<SqlEditor bind:value={cell.value} {name} readonly={disabled} minLines={4} aria-label={label} />
	{:else}
		<Textarea
			{name}
			bind:value={cell.value}
			{disabled}
			aria-label={label}
			rows={settings.textareaRows}
			spellcheck={false}
			class="font-mono"
			data-transform={column.inputTransform.id}
		/>
	{/if}
{:else if column.protected}
	<div class="flex flex-wrap items-center gap-2 text-sm">
		<span class="text-muted-foreground">
			{size !== null
				? t('Binary - do not edit ({size} B)', { size })
				: t('Binary - do not edit')}
		</span>
		<input
			type="file"
			name={fileName}
			{disabled}
			aria-label={t('Upload {name}', { name: column.name })}
			class="text-xs"
		/>
	</div>
{:else if column.foreign?.options}
	<FkSelect {name} options={column.foreign.options} bind:value={cell.value} {disabled} {label} />
{:else if kind === 'enum'}
	{#if column.enumValues.length <= 20}
		<RadioGroup.Root
			{name}
			bind:value={cell.value}
			{disabled}
			aria-label={label}
			class="flex flex-wrap gap-x-4 gap-y-1"
		>
			{#each column.enumValues as v (v)}
				<div class="flex items-center gap-1.5">
					<RadioGroup.Item value={v} id="{name}-{v}" />
					<Label for="{name}-{v}" class="font-normal">{v}</Label>
				</div>
			{/each}
		</RadioGroup.Root>
	{:else}
		<NativeSelect {name} bind:value={cell.value} {disabled} aria-label={label}>
			<NativeSelectOption value=""></NativeSelectOption>
			{#each column.enumValues as v (v)}
				<NativeSelectOption value={v}>{v}</NativeSelectOption>
			{/each}
		</NativeSelect>
	{/if}
{:else if kind === 'set'}
	<div class="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label={label}>
		{#each column.enumValues as v (v)}
			<div class="flex items-center gap-1.5">
				<Checkbox
					id="{name}-{v}"
					{disabled}
					checked={cell.setValues.includes(v)}
					onCheckedChange={(on) => toggleSet(v, on === true)}
				/>
				<Label for="{name}-{v}" class="font-normal">{v}</Label>
			</div>
		{/each}
		{#if !disabled}
			{#each cell.setValues as v (v)}
				<input type="hidden" {name} value={v} />
			{/each}
		{/if}
	</div>
{:else if kind === 'text' || kind === 'json' || (kind === 'char' && settings.charEditing === 'textarea')}
	<div class="flex flex-col gap-1">
		<Textarea
			{name}
			bind:value={cell.value}
			{disabled}
			aria-label={label}
			aria-invalid={error ? true : undefined}
			rows={kind === 'char' ? settings.charTextareaRows : textRows}
			cols={kind === 'char' ? settings.charTextareaCols : textCols}
			class="font-mono"
		/>
		{#if error}
			<p class="text-xs text-destructive" role="alert">{t('Invalid JSON: {error}', { error })}</p>
		{/if}
	</div>
{:else if kind === 'blob'}
	<div class="flex flex-col gap-1">
		<Textarea
			{name}
			bind:value={cell.value}
			{disabled}
			aria-label={label}
			rows={3}
			placeholder={t('0x hexadecimal')}
			class="font-mono"
		/>
		<input
			type="file"
			name={fileName}
			{disabled}
			aria-label={t('Upload {name}', { name: column.name })}
			class="text-xs"
		/>
	</div>
{:else if isDateLike}
	<div class="flex items-center gap-1">
		<Input
			{name}
			bind:value={cell.value}
			{disabled}
			aria-label={label}
			placeholder={kind === 'date'
				? 'YYYY-MM-DD'
				: kind === 'time'
					? 'HH:MM:SS'
					: 'YYYY-MM-DD HH:MM:SS'}
			class="w-52 font-mono"
		/>
		<input
			bind:this={picker}
			type={inputType}
			tabindex="-1"
			aria-hidden="true"
			class="pointer-events-none absolute size-0 opacity-0"
			value={pickerValue()}
			onchange={(e) => fromPicker(e.currentTarget.value)}
		/>
		<Button
			type="button"
			variant="ghost"
			size="icon"
			{disabled}
			aria-label={t('Pick {name} date', { name: column.name })}
			onclick={() => picker?.showPicker?.()}
		>
			<Calendar class="size-4" />
		</Button>
	</div>
{:else if kind === 'int' || kind === 'decimal' || kind === 'float'}
	<Input
		type="number"
		{name}
		{step}
		value={cell.value}
		oninput={(e) => (cell.value = e.currentTarget.value)}
		{disabled}
		aria-label={label}
		class="w-52"
	/>
{:else if kind === 'year'}
	<Input
		type="number"
		{name}
		value={cell.value}
		oninput={(e) => (cell.value = e.currentTarget.value)}
		{disabled}
		aria-label={label}
		min="0"
		max="9999"
		class="w-28"
	/>
{:else if kind === 'bit'}
	<Input
		{name}
		bind:value={cell.value}
		{disabled}
		aria-label={label}
		placeholder={'0'.repeat(column.length || 1)}
		pattern="[01]*"
		class="w-52 font-mono"
	/>
{:else if kind === 'spatial'}
	<div class="flex flex-wrap items-center gap-2">
		<Input
			{name}
			bind:value={cell.value}
			{disabled}
			aria-label={label}
			size={sizeAttr}
			class="font-mono"
			placeholder="POINT(1 2)"
		/>
		<Button
			type="button"
			variant="outline"
			size="sm"
			{disabled}
			aria-label={t('GIS editor for {name}', { name: column.name })}
			onclick={() => (gisOpen = true)}
		>
			GIS
		</Button>
	</div>
	{#if gisOpen}
		<GisEditorDialog
			bind:open={gisOpen}
			value={cell.value}
			column={column.name}
			onapply={(wkt) => (cell.value = wkt)}
		/>
	{/if}
{:else}
	<Input
		{name}
		bind:value={cell.value}
		{disabled}
		aria-label={label}
		size={sizeAttr}
		class={kind === 'binary' ? 'font-mono' : ''}
		placeholder={kind === 'binary'
			? t('0x hexadecimal')
			: column.foreign && !column.foreign.options
				? t('Referenced key (too many values to list)')
				: ''}
	/>
{/if}
