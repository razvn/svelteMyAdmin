/**
 * Microsoft Word 2000 (HTML) export, port of libraries/classes/Plugins/Export/ExportHtmlword.php.
 * The document is HTML that Word opens: one `<h2>` per structure or data block, tables with the
 * `print` classes phpMyAdmin uses.
 */
import type { ExportOption, ExportPlugin, ExportScope } from '../types.ts';
import {
	emit,
	htmlEscape,
	optBool,
	optString,
	type Piece,
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

const HTMLWORD_SCOPES: ExportScope[] = ['server', 'database', 'table'];

export const HTMLWORD_OPTIONS: ExportOption[] = [
	{ kind: 'text', name: 'null', label: 'Replace NULL with:', default: 'NULL' },
	{ kind: 'bool', name: 'columns', label: 'Put columns names in the first row', default: false }
];

/** Document prologue, byte-for-byte the PHP one (charset is always UTF-8 here). */
export const HTMLWORD_HEADER = [
	'<html xmlns:o="urn:schemas-microsoft-com:office:office"',
	'            xmlns:x="urn:schemas-microsoft-com:office:word"',
	'            xmlns="http://www.w3.org/TR/REC-html40">',
	'',
	'            <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
	'            <html>',
	'            <head>',
	'                <meta http-equiv="Content-type" content="text/html;charset=utf-8" />',
	'            </head>',
	'            <body>'
].join('\n');

const TABLE_OPEN = '<table width="100%" cellspacing="1">';

/** `formatOneColumnDefinition()` row (the caller closes the `<tr>`). */
export function htmlwordColumnRow(column: ColumnInfo, unique: readonly string[]): string {
	let pre = '';
	let post = '';
	if (unique.includes(column.field)) {
		pre = '<strong>' + pre;
		post += '</strong>';
	}
	if (column.key === 'PRI') {
		pre = '<em>' + pre;
		post += '</em>';
	}
	const type = printColumnType(column.type);
	return (
		'<tr class="print-category">' +
		`<td class="print">${pre}${htmlEscape(column.field)}${post}</td>` +
		`<td class="print">${htmlEscape(type === '' ? '&nbsp;' : type)}</td>` +
		`<td class="print">${nullableLabel(column)}</td>` +
		`<td class="print">${htmlEscape(displayDefault(column))}</td>`
	);
}

function tableDefinition(columns: readonly ColumnInfo[], unique: readonly string[]): string {
	let out =
		TABLE_OPEN +
		'<tr class="print-category">' +
		'<th class="print">Column</th>' +
		'<td class="print"><strong>Type</strong></td>' +
		'<td class="print"><strong>Null</strong></td>' +
		'<td class="print"><strong>Default</strong></td>' +
		'</tr>';
	for (const column of columns) out += htmlwordColumnRow(column, unique) + '</tr>';
	return out + '</table>';
}

const htmlword: ExportPlugin = {
	id: 'htmlword',
	label: 'Microsoft Word 2000',
	extension: 'doc',
	mimeType: 'application/vnd.ms-word',
	scopes: HTMLWORD_SCOPES,
	supports: { structure: true, data: true },
	options: HTMLWORD_OPTIONS,

	async header(ctx) {
		await ctx.write(HTMLWORD_HEADER);
	},

	async footer(ctx) {
		await ctx.write('</body></html>');
	},

	async dbHeader(ctx, db, alias) {
		await ctx.write(`<h1>Database ${htmlEscape(alias || db)}</h1>`);
	},

	async structure(ctx, ref, what) {
		if (what === 'data') return;
		const isView = ref.kind === 'view';
		const alias = htmlEscape(ref.alias || ref.table);
		const columns = await loadColumns(ctx.conn, ref.db, ref.table);
		const unique = isView ? [] : await loadUniqueColumns(ctx.conn, ref.db, ref.table);
		let out = isView
			? `<h2>Structure for view ${alias}</h2>`
			: `<h2>Table structure for table ${alias}</h2>`;
		out += tableDefinition(columns, unique);
		if (!isView) {
			const triggers = await loadTriggers(ctx.conn, ref.db, ref.table);
			if (triggers.length > 0) {
				out += `<h2>Triggers ${alias}</h2>`;
				out +=
					TABLE_OPEN +
					'<tr class="print-category">' +
					'<th class="print">Name</th>' +
					'<td class="print"><strong>Time</strong></td>' +
					'<td class="print"><strong>Event</strong></td>' +
					'<td class="print"><strong>Definition</strong></td>' +
					'</tr>';
				for (const trigger of triggers) {
					out +=
						'<tr class="print-category">' +
						`<td class="print">${htmlEscape(trigger.name)}</td>` +
						`<td class="print">${htmlEscape(trigger.timing)}</td>` +
						`<td class="print">${htmlEscape(trigger.event)}</td>` +
						`<td class="print">${htmlEscape(trigger.statement)}</td>` +
						'</tr>';
				}
				out += '</table>';
			}
		}
		await ctx.write(out);
	},

	async data(ctx, data) {
		const o = resolveOptions(HTMLWORD_OPTIONS, ctx.options);
		const alias = htmlEscape(data.ref.alias || data.ref.table);
		const nullText = optString(o, 'null');
		await ctx.write(`<h2>Dumping data for table ${alias}</h2>` + TABLE_OPEN);
		if (optBool(o, 'columns')) {
			let header = '<tr class="print-category">';
			for (const field of data.fields) {
				header += `<td class="print"><strong>${htmlEscape(field.name)}</strong></td>`;
			}
			await ctx.write(header + '</tr>');
		}
		for await (const row of data.rows) {
			const line: Piece[] = ['<tr class="print-category">'];
			data.fields.forEach((_field, j) => {
				const cell = row[j] ?? null;
				// NULL becomes the null text; empty values stay empty.
				const value: Piece = cell === null ? nullText : cell.length === 0 ? '' : cell;
				line.push('<td class="print">', htmlEscape(value), '</td>');
			});
			line.push('</tr>');
			await emit(ctx, line);
		}
		await ctx.write('</table>');
	}
};

export default htmlword;
