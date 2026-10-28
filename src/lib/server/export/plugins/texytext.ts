/**
 * Texy! text export, port of libraries/classes/Plugins/Export/ExportTexytext.php.
 * Headings are `==` / `===` and tables use the `|---` row syntax. Like PHP, the newlines are
 * always LF, independent of the context line ending.
 *
 * Not ported: relation links and column comments / media types (they live in the pma__ tables).
 */
import type { ExportOption, ExportPlugin, ExportScope } from '../types.ts';
import {
	emit,
	htmlEscape,
	optBool,
	optString,
	type Piece,
	replaceAll,
	resolveOptions
} from './plugin-utils.ts';
import {
	displayDefault,
	loadColumns,
	loadTriggers,
	loadUniqueColumns,
	nullableLabel,
	printColumnType,
	type ColumnInfo
} from './table-info.ts';

const TEXY_SCOPES: ExportScope[] = ['server', 'database', 'table', 'raw'];

export const TEXY_OPTIONS: ExportOption[] = [
	{ kind: 'bool', name: 'columns', label: 'Put columns names in the first row', default: false },
	{ kind: 'text', name: 'null', label: 'Replace NULL with:', default: 'NULL' }
];

/** One column line of the structure table (ExportTexytext::formatOneColumnDefinition). */
export function texyColumnLine(column: ColumnInfo, unique: readonly string[]): string {
	let pre = '';
	let post = '';
	if (unique.includes(column.field)) {
		pre = '**';
		post = '**';
	}
	if (column.key === 'PRI') {
		pre = '//' + pre;
		post = post + '//';
	}
	const type = printColumnType(column.type);
	return (
		`|${pre}${htmlEscape(column.field)}${post}` +
		`|${htmlEscape(type === '' ? '&nbsp;' : type)}` +
		`|${nullableLabel(column)}` +
		`|${htmlEscape(displayDefault(column))}`
	);
}

const texytext: ExportPlugin = {
	id: 'texytext',
	label: 'Texy! text',
	extension: 'txt',
	mimeType: 'text/plain',
	scopes: TEXY_SCOPES,
	supports: { structure: true, data: true },
	options: TEXY_OPTIONS,

	async dbHeader(ctx, db, alias) {
		await ctx.write(`===Database ${alias || db}\n\n`);
	},

	async structure(ctx, ref, what) {
		if (what === 'data') return;
		const alias = ref.alias || ref.table;
		const isView = ref.kind === 'view';
		const columns = await loadColumns(ctx.conn, ref.db, ref.table);
		const unique = isView ? [] : await loadUniqueColumns(ctx.conn, ref.db, ref.table);
		let out = isView
			? `== Structure for view ${alias}\n\n`
			: `== Table structure for table ${alias}\n\n`;
		out += '|------\n|Column|Type|Null|Default\n|------\n';
		for (const column of columns) out += texyColumnLine(column, unique) + '\n';
		if (!isView) {
			const triggers = await loadTriggers(ctx.conn, ref.db, ref.table);
			if (triggers.length > 0) {
				out += `== Triggers ${alias}\n\n`;
				out += '|------\n|Name|Time|Event|Definition\n|------\n';
				for (const trigger of triggers) {
					out +=
						`|${trigger.name}|${trigger.timing}|${trigger.event}|` +
						replaceAll(htmlEscape(trigger.statement), '|', '&#124;') +
						'\n';
				}
			}
		}
		await ctx.write(out);
	},

	async data(ctx, data) {
		const o = resolveOptions(TEXY_OPTIONS, ctx.options);
		const alias = data.ref.alias || data.ref.table;
		const nullText = optString(o, 'null');
		await ctx.write(
			alias !== ''
				? `== Dumping data for table ${alias}\n\n`
				: '==Dumping data for query result\n\n'
		);
		if (optBool(o, 'columns')) {
			let header = '|------\n';
			for (const field of data.fields) header += '|' + htmlEscape(field.name);
			await ctx.write(header + '\n|------\n');
		}
		for await (const row of data.rows) {
			const line: Piece[] = [];
			data.fields.forEach((_field, j) => {
				const cell = row[j] ?? null;
				// Empty values are written as a single space, NULL as the null text.
				const value: Piece = cell === null ? nullText : cell.length === 0 ? ' ' : cell;
				line.push('|', replaceAll(htmlEscape(value), '|', '&#124;'));
			});
			line.push('\n');
			await emit(ctx, line);
		}
	}
};

export default texytext;
