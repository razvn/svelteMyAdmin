import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/** Editor chrome built only from the app CSS tokens (light/dark switch with the `.dark` class). */
export const editorTheme = EditorView.theme({
	'&': {
		backgroundColor: 'var(--card)',
		color: 'var(--card-foreground)',
		fontSize: '13px',
		border: '1px solid var(--input)',
		borderRadius: 'calc(var(--radius) - 2px)'
	},
	'&.cm-focused': {
		outline: 'none',
		borderColor: 'var(--ring)',
		boxShadow: '0 0 0 3px color-mix(in oklab, var(--ring) 35%, transparent)'
	},
	'.cm-scroller': {
		fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
		lineHeight: '1.5',
		overflow: 'auto',
		maxHeight: 'var(--sql-editor-max-height, 24rem)'
	},
	'.cm-content': {
		minHeight: 'var(--sql-editor-min-height, 6rem)',
		caretColor: 'var(--primary)',
		padding: '6px 0'
	},
	'.cm-gutters': {
		backgroundColor: 'var(--muted)',
		color: 'var(--muted-foreground)',
		border: 'none',
		borderRight: '1px solid var(--border)'
	},
	'.cm-activeLine': { backgroundColor: 'transparent' },
	'.cm-activeLineGutter': { backgroundColor: 'var(--accent)', color: 'var(--foreground)' },
	'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--primary)' },
	'.cm-selectionBackground': { backgroundColor: 'var(--primary-soft)' },
	'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
		backgroundColor: 'var(--primary-soft)'
	},
	'.cm-content ::selection': { backgroundColor: 'var(--primary-soft)' },
	'.cm-selectionMatch': { backgroundColor: 'var(--accent)' },
	'&.cm-focused .cm-matchingBracket': {
		backgroundColor: 'var(--primary-soft)',
		outline: '1px solid var(--primary)'
	},
	'&.cm-focused .cm-nonmatchingBracket': {
		backgroundColor: 'var(--destructive-soft)',
		outline: '1px solid var(--destructive)'
	},
	'.cm-placeholder': { color: 'var(--muted-foreground)' },
	'.cm-panels': {
		backgroundColor: 'var(--muted)',
		color: 'var(--foreground)',
		fontFamily: "'Inter Variable', sans-serif"
	},
	'.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
	'.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
	'.cm-panel.cm-search input, .cm-panel.cm-search button': {
		fontFamily: "'Inter Variable', sans-serif",
		fontSize: '12px'
	},
	'.cm-panel.cm-search input.cm-textfield': {
		backgroundColor: 'var(--card)',
		color: 'var(--foreground)',
		border: '1px solid var(--input)',
		borderRadius: '4px'
	},
	'.cm-panel.cm-search button': {
		backgroundColor: 'var(--card)',
		backgroundImage: 'none',
		color: 'var(--foreground)',
		border: '1px solid var(--input)',
		borderRadius: '4px'
	},
	'.cm-searchMatch': { backgroundColor: 'var(--warning-soft)' },
	'.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--primary-soft)' },
	'.cm-tooltip': {
		backgroundColor: 'var(--popover)',
		color: 'var(--popover-foreground)',
		border: '1px solid var(--border)',
		borderRadius: '6px',
		fontFamily: "'Inter Variable', sans-serif"
	},
	'.cm-tooltip.cm-tooltip-autocomplete > ul': {
		fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
		fontSize: '12px'
	},
	'.cm-tooltip-autocomplete ul li[aria-selected]': {
		backgroundColor: 'var(--primary-soft)',
		color: 'var(--foreground)'
	},
	'.cm-diagnostic-error': { borderLeftColor: 'var(--destructive)' },
	'.cm-diagnostic-warning': { borderLeftColor: 'var(--warning)' }
});

export const highlightStyle = HighlightStyle.define([
	{
		tag: [t.keyword, t.standard(t.keyword), t.operatorKeyword],
		color: 'var(--chart-1)',
		fontWeight: '600'
	},
	{ tag: [t.typeName, t.standard(t.typeName), t.className], color: 'var(--chart-2)' },
	{
		tag: [t.function(t.variableName), t.function(t.propertyName), t.special(t.name)],
		color: 'var(--chart-5)'
	},
	{ tag: [t.string, t.special(t.string)], color: 'var(--success)' },
	{ tag: [t.number, t.bool, t.null, t.atom], color: 'var(--warning)' },
	{
		tag: [t.comment, t.lineComment, t.blockComment],
		color: 'var(--muted-foreground)',
		fontStyle: 'italic'
	},
	{ tag: [t.operator, t.punctuation, t.separator], color: 'var(--muted-foreground)' },
	{ tag: [t.name, t.propertyName, t.variableName], color: 'var(--foreground)' }
]);
