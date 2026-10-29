/**
 * LaTeX export, port of libraries/classes/Plugins/Export/ExportLatex.php.
 * Tables are `longtable` environments with captions, labels, continued captions and column headers.
 *
 * Differences from PHP:
 * - Relation, comment and media-type columns are not exported (they live in the pma__ tables).
 * - PHP applies `stripslashes()` to values and column names (a magic-quotes leftover that
 *   corrupts data such as `C:\dir`); it is not applied here.
 * - Caption defaults are the English messages behind PHP's `strLatex*` keys.
 */
import { N_ } from '#lib/i18n/translator.ts';
import type { ExportOption, ExportPlugin, ExportScope } from '../types.ts';
import {
	emit,
	optBool,
	optString,
	type Piece,
	resolveOptions,
	localisedDate,
	texEscape
} from './plugin-utils.ts';
import {
	displayDefault,
	loadColumns,
	loadUniqueColumns,
	nullableLabel,
	printColumnType
} from './table-info.ts';

const LATEX_SCOPES: ExportScope[] = ['server', 'database', 'table', 'raw'];

export const LATEX_OPTIONS: ExportOption[] = [
	{ kind: 'bool', name: 'caption', label: N_('Include table caption'), default: true },
	{
		kind: 'text',
		name: 'structure_caption',
		label: N_('Table caption:'),
		default: 'Structure of table @TABLE@'
	},
	{
		kind: 'text',
		name: 'structure_continued_caption',
		label: N_('Table caption (continued):'),
		default: 'Structure of table @TABLE@ (continued)'
	},
	{
		kind: 'text',
		name: 'structure_label',
		label: N_('Label key:'),
		default: 'tab:@TABLE@-structure'
	},
	{
		kind: 'bool',
		name: 'columns',
		label: N_('Put columns names in the first row:'),
		default: true
	},
	{
		kind: 'text',
		name: 'data_caption',
		label: N_('Table caption:'),
		default: 'Content of table @TABLE@'
	},
	{
		kind: 'text',
		name: 'data_continued_caption',
		label: N_('Table caption (continued):'),
		default: 'Content of table @TABLE@ (continued)'
	},
	{ kind: 'text', name: 'data_label', label: N_('Label key:'), default: 'tab:@TABLE@-data' },
	{ kind: 'text', name: 'null', label: N_('Replace NULL with:'), default: '\\textit{NULL}' }
];

/**
 * `Util::expandUserString()` for the placeholders the LaTeX captions use. Replacement values are
 * passed through `escape` (texEscape), the template text itself is kept as written.
 */
export function expandUserString(
	template: string,
	escape: (value: string) => string,
	values: { table: string; database: string; server: string }
): string {
	const replacements: Record<string, string> = {
		'@TABLE@': values.table,
		'@DATABASE@': values.database,
		'@SERVER@': values.server,
		'@PHPMYADMIN@': 'svelteMyAdmin'
	};
	return template.replace(/@(TABLE|DATABASE|SERVER|PHPMYADMIN)@/g, (match) =>
		escape(replacements[match] ?? match)
	);
}

const STRUCTURE_HEADER =
	' \\hline \\multicolumn{1}{|c|}{\\textbf{Column}} & \\multicolumn{1}{|c|}{\\textbf{Type}}' +
	' & \\multicolumn{1}{|c|}{\\textbf{Null}} & \\multicolumn{1}{|c|}{\\textbf{Default}}';

/** `$buffer` of the column header row used on the data longtable. */
function dataColumnHeader(names: readonly string[]): string {
	let buffer = '\\hline ';
	for (const name of names) {
		buffer += '\\multicolumn{1}{|c|}{\\textbf{' + texEscape(name) + '}} & ';
	}
	// PHP drops the trailing `& ` and appends the row end.
	return buffer.slice(0, -2) + '\\\\ \\hline \\hline ';
}

const latex: ExportPlugin = {
	id: 'latex',
	label: N_('LaTeX'),
	extension: 'tex',
	mimeType: 'application/x-tex',
	scopes: LATEX_SCOPES,
	supports: { structure: true, data: true },
	options: LATEX_OPTIONS,

	async header(ctx) {
		const crlf = ctx.crlf;
		await ctx.write(
			[
				'% svelteMyAdmin LaTeX Dump',
				`% version ${ctx.appVersion}`,
				'%',
				`% Host: ${ctx.server.host}`,
				`% Generation Time: ${localisedDate(ctx.now)}`,
				`% Server version: ${ctx.server.version}`,
				''
			].join(crlf) + crlf
		);
	},

	async dbHeader(ctx, db, alias) {
		const crlf = ctx.crlf;
		await ctx.write('% ' + crlf + `% Database: '${alias || db}'` + crlf + '% ' + crlf);
	},

	async structure(ctx, ref, what) {
		if (what === 'data') return;
		const o = resolveOptions(LATEX_OPTIONS, ctx.options);
		const crlf = ctx.crlf;
		const alias = ref.alias || ref.table;
		const values = { table: alias, database: ref.db, server: ctx.server.host };
		const escapeTex = (value: string): string => texEscape(value);
		const caption = optBool(o, 'caption');

		const columns = await loadColumns(ctx.conn, ref.db, ref.table);
		const unique = ref.kind === 'table' ? await loadUniqueColumns(ctx.conn, ref.db, ref.table) : [];

		let out =
			crlf +
			'%' +
			crlf +
			'% Structure: ' +
			alias +
			crlf +
			'%' +
			crlf +
			' \\begin{longtable}{' +
			'|l|c|c|c|' +
			'} ' +
			crlf;
		if (caption) {
			out +=
				' \\caption{' +
				expandUserString(optString(o, 'structure_caption'), escapeTex, values) +
				'} \\label{' +
				expandUserString(optString(o, 'structure_label'), (v) => v, values) +
				'} \\\\' +
				crlf;
		}
		out += STRUCTURE_HEADER + ' \\\\ \\hline \\hline' + crlf + '\\endfirsthead' + crlf;
		if (caption) {
			out +=
				' \\caption{' +
				expandUserString(optString(o, 'structure_continued_caption'), escapeTex, values) +
				'} \\\\ ' +
				crlf;
		}
		out += STRUCTURE_HEADER + ' \\\\ \\hline \\hline \\endhead \\endfoot ' + crlf;

		for (const column of columns) {
			const parts = [
				column.field,
				printColumnType(column.type) || ' ',
				nullableLabel(column),
				displayDefault(column)
			].map(texEscape);
			if (column.key === 'PRI') parts[0] = '\\textit{' + parts[0] + '}';
			if (unique.includes(column.field)) parts[0] = '\\textbf{' + parts[0] + '}';
			out += parts.join(' & ') + ' \\\\ \\hline ' + crlf;
		}
		out += ' \\end{longtable}' + crlf;
		await ctx.write(out);
	},

	async data(ctx, data) {
		const o = resolveOptions(LATEX_OPTIONS, ctx.options);
		const crlf = ctx.crlf;
		const alias = data.ref.alias || data.ref.table;
		const values = { table: alias, database: data.ref.db, server: ctx.server.host };
		const escapeTex = (value: string): string => texEscape(value);
		const caption = optBool(o, 'caption');
		const nullText = optString(o, 'null');
		const names = data.fields.map((field) => field.name);

		let head =
			crlf +
			'%' +
			crlf +
			'% Data: ' +
			alias +
			crlf +
			'%' +
			crlf +
			' \\begin{longtable}{|' +
			'l|'.repeat(names.length) +
			'} ' +
			crlf +
			' \\hline \\endhead \\hline \\endfoot \\hline ' +
			crlf;
		if (caption) {
			head +=
				' \\caption{' +
				expandUserString(optString(o, 'data_caption'), escapeTex, values) +
				'} \\label{' +
				expandUserString(optString(o, 'data_label'), (v) => v, values) +
				'} \\\\';
		}
		await ctx.write(head);

		if (optBool(o, 'columns')) {
			const header = dataColumnHeader(names);
			let out = header + ' \\endfirsthead ' + crlf;
			if (caption) {
				out +=
					'\\caption{' +
					expandUserString(optString(o, 'data_continued_caption'), escapeTex, values) +
					'} \\\\ ';
			}
			out += header + '\\endhead \\endfoot' + crlf;
			await ctx.write(out);
		} else {
			await ctx.write('\\\\ \\hline');
		}

		for await (const row of data.rows) {
			const cells: Piece[][] = data.fields.map((_field, i) => {
				const cell = row[i] ?? null;
				return cell === null ? [nullText] : [texEscape(cell)];
			});
			const line: Piece[] = [];
			cells.forEach((cell, i) => {
				if (i > 0) line.push(' & ');
				line.push(...cell);
			});
			line.push(' \\\\ \\hline ' + crlf);
			await emit(ctx, line);
		}
		await ctx.write(' \\end{longtable}' + crlf);
	}
};

export default latex;
