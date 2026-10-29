<script lang="ts">
	import {
		autocompletion,
		closeBrackets,
		closeBracketsKeymap,
		completionKeymap
	} from '@codemirror/autocomplete';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { MariaSQL, MySQL, sql } from '@codemirror/lang-sql';
	import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
	import { linter, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint';
	import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
	import { Compartment, EditorState, Prec } from '@codemirror/state';
	import {
		drawSelection,
		EditorView,
		highlightActiveLineGutter,
		keymap,
		lineNumbers,
		placeholder as placeholderExt
	} from '@codemirror/view';
	import { untrack } from 'svelte';
	import { cn } from '#lib/utils.ts';
	import { formatSql, type SqlDialect } from '#lib/sql/editor/format.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import { lintSql } from '#lib/sql/editor/lint.ts';
	import { parseSchemaResponse, toSqlNamespace, type SqlSchema } from '#lib/sql/editor/schema.ts';
	import { editorTheme, highlightStyle } from './theme.ts';

	interface Props {
		value?: string;
		dialect?: SqlDialect;
		/** table -> columns, used for completion. */
		schema?: SqlSchema;
		/** Endpoint returning `{ tables }` (e.g. `/api/sql/schema?db=x`), fetched once on mount. */
		schemaUrl?: string;
		readonly?: boolean;
		minLines?: number;
		/** CSS length, e.g. `24rem`. */
		maxHeight?: string;
		placeholder?: string;
		/** Complete keywords in upper case. */
		upperCaseKeywords?: boolean;
		/** Show client-side diagnostics (unbalanced quotes, backticks, parentheses). */
		lint?: boolean;
		onrun?: (value: string) => void;
		onchange?: (value: string) => void;
		/** Name of the form field mirroring the value. */
		name?: string;
		id?: string;
		'aria-label'?: string;
		class?: string;
	}

	let {
		value = $bindable(''),
		dialect = 'mysql',
		schema,
		schemaUrl,
		readonly = false,
		minLines = 5,
		maxHeight = '24rem',
		placeholder = '',
		upperCaseKeywords = true,
		lint = true,
		onrun,
		onchange,
		name,
		id,
		'aria-label': ariaLabel,
		class: className
	}: Props = $props();

	const { t } = useI18n();
	let view = $state.raw<EditorView>();
	let ready = $state(false);
	let dark = $state(false);
	let fetchedSchema = $state.raw<SqlSchema>({});

	const langC = new Compartment();
	const flagsC = new Compartment();
	const darkC = new Compartment();

	const effectiveSchema = $derived(schema ?? fetchedSchema);

	function langExt() {
		return sql({
			dialect: dialect === 'mariadb' ? MariaSQL : MySQL,
			schema: toSqlNamespace(effectiveSchema),
			upperCaseKeywords
		});
	}

	function flagsExt() {
		return [
			EditorState.readOnly.of(readonly),
			EditorView.editable.of(!readonly),
			EditorView.contentAttributes.of({
				...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
				...(id ? { id } : {}),
				spellcheck: 'false',
				autocapitalize: 'off'
			}),
			placeholder ? placeholderExt(placeholder) : [],
			lint
				? [
						linter(
							(v): Diagnostic[] =>
								lintSql(v.state.doc.toString()).map((i) => ({
									from: i.from,
									to: i.to,
									severity: i.severity,
									message: i.msgid ? t(i.msgid, i.params) /* i18n-ignore */ : i.message
								})),
							{ delay: 300 }
						),
						lintGutter()
					]
				: []
		];
	}

	function mount(host: HTMLElement) {
		const v = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: untrack(() => value),
				extensions: [
					lineNumbers(),
					highlightActiveLineGutter(),
					history(),
					drawSelection(),
					indentOnInput(),
					bracketMatching(),
					closeBrackets(),
					highlightSelectionMatches(),
					autocompletion(),
					syntaxHighlighting(highlightStyle),
					editorTheme,
					EditorView.lineWrapping,
					Prec.highest(
						keymap.of([
							{
								key: 'Mod-Enter',
								preventDefault: true,
								run: (target) => {
									onrun?.(target.state.doc.toString());
									return true;
								}
							}
						])
					),
					keymap.of([
						...closeBracketsKeymap,
						...defaultKeymap,
						...searchKeymap,
						...historyKeymap,
						...completionKeymap,
						...lintKeymap
					]),
					EditorView.updateListener.of((u) => {
						if (!u.docChanged) return;
						const next = u.state.doc.toString();
						if (next === value) return;
						value = next;
						onchange?.(next);
					}),
					langC.of(untrack(langExt)),
					flagsC.of(untrack(flagsExt)),
					darkC.of(EditorView.darkTheme.of(untrack(() => dark)))
				]
			})
		});
		view = v;
		ready = true;
		return () => {
			v.destroy();
			view = undefined;
			ready = false;
		};
	}

	/** Track the `.dark` class mode-watcher puts on <html>. */
	function watchTheme() {
		const root = document.documentElement;
		const update = () => (dark = root.classList.contains('dark'));
		update();
		const mo = new MutationObserver(update);
		mo.observe(root, { attributes: true, attributeFilter: ['class'] });
		return () => mo.disconnect();
	}

	function loadSchema() {
		if (!schemaUrl || schema) return;
		const ctrl = new AbortController();
		fetch(schemaUrl, { signal: ctrl.signal })
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (data) fetchedSchema = parseSchemaResponse(data);
			})
			.catch(() => {});
		return () => ctrl.abort();
	}

	$effect(watchTheme);
	$effect(loadSchema);

	// value -> editor
	$effect(() => {
		const v = view;
		const next = value ?? '';
		if (v && next !== v.state.doc.toString()) {
			v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } });
		}
	});
	$effect(() => {
		view?.dispatch({ effects: langC.reconfigure(langExt()) });
	});
	$effect(() => {
		view?.dispatch({ effects: flagsC.reconfigure(flagsExt()) });
	});
	$effect(() => {
		view?.dispatch({ effects: darkC.reconfigure(EditorView.darkTheme.of(dark)) });
	});

	export function focus() {
		view?.focus();
	}

	/** Insert text at the cursor (replacing the selection) and keep focus in the editor. */
	export function insertText(text: string) {
		const v = view;
		if (!v) {
			value = (value ?? '') + text;
			return;
		}
		const { from, to } = v.state.selection.main;
		v.dispatch({
			changes: { from, to, insert: text },
			selection: { anchor: from + text.length },
			userEvent: 'input'
		});
		v.focus();
	}

	/** Reformat the whole document with sql-formatter. */
	export function format() {
		const v = view;
		const current = v ? v.state.doc.toString() : (value ?? '');
		const next = formatSql(current, dialect);
		if (next === current) return;
		if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } });
		else value = next;
	}
</script>

<div
	class={cn('sql-editor w-full', className)}
	data-slot="sql-editor"
	data-ready={ready}
	style:--sql-editor-min-height="{minLines * 1.5}em"
	style:--sql-editor-max-height={maxHeight}
>
	{#if !ready}
		<textarea
			{id}
			{name}
			{readonly}
			{placeholder}
			aria-label={ariaLabel}
			rows={minLines}
			spellcheck={false}
			bind:value
			class="block w-full rounded-md border border-input bg-card px-2.5 py-1.5 font-mono text-[13px] leading-normal text-card-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
		></textarea>
	{:else if name}
		<input type="hidden" {name} {value} />
	{/if}
	<div class={ready ? '' : 'hidden'} {@attach mount}></div>
</div>
