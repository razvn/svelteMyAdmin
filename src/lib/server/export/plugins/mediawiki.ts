/**
 * MediaWiki table export, port of libraries/classes/Plugins/Export/ExportMediawiki.php.
 * Output always uses LF (MediaWiki expects "\n", whatever the context line ending is).
 */
import { N_ } from '#lib/i18n/translator.ts';
import type { ExportOption, ExportPlugin, ExportScope } from '../types.ts';
import {
	backquote,
	emit,
	htmlEscape,
	optBool,
	type Piece,
	resolveOptions
} from './plugin-utils.ts';
import { loadColumns } from './table-info.ts';

const MEDIAWIKI_SCOPES: ExportScope[] = ['server', 'database', 'table', 'raw'];

export const MEDIAWIKI_OPTIONS: ExportOption[] = [
	{ kind: 'bool', name: 'caption', label: N_('Export table names'), default: true },
	{ kind: 'bool', name: 'headers', label: N_('Export table headers'), default: true }
];

const LF = '\n';

/** `exportComment()`: an HTML comment with the escaped text, followed by two newlines. */
function comment(text: string): string {
	return LF + '<!--' + LF + htmlEscape(text) + LF + '-->' + LF + LF;
}

const mediawiki: ExportPlugin = {
	id: 'mediawiki',
	label: N_('MediaWiki Table'),
	extension: 'mediawiki',
	mimeType: 'text/plain',
	scopes: MEDIAWIKI_SCOPES,
	supports: { structure: true, data: true },
	options: MEDIAWIKI_OPTIONS,

	async structure(ctx, ref, what) {
		// Only tables get the structure table (PHP: 'create_table'; views fall through to nothing).
		if (what === 'data' || ref.kind !== 'table') return;
		const o = resolveOptions(MEDIAWIKI_OPTIONS, ctx.options);
		const alias = ref.alias || ref.table;
		const columns = await loadColumns(ctx.conn, ref.db, ref.table);
		let out = comment('Table structure for ' + backquote(alias));
		out += '{| class="wikitable" style="text-align:center;"' + LF;
		if (optBool(o, 'caption')) out += `|+'''${alias}'''` + LF;
		if (optBool(o, 'headers')) {
			out += '|- style="background:#ffdead;"' + LF;
			out += '! style="background:#ffffff" | ' + LF;
			for (const column of columns) out += ' | ' + column.field + LF;
		}
		out += '|-' + LF + '! Type' + LF;
		for (const column of columns) out += ' | ' + column.type + LF;
		out += '|-' + LF + '! Null' + LF;
		for (const column of columns) out += ' | ' + column.null + LF;
		out += '|-' + LF + '! Default' + LF;
		for (const column of columns) out += ' | ' + (column.default ?? '') + LF;
		out += '|-' + LF + '! Extra' + LF;
		for (const column of columns) out += ' | ' + column.extra + LF;
		out += '|}' + LF + LF;
		await ctx.write(out);
	},

	async data(ctx, data) {
		const o = resolveOptions(MEDIAWIKI_OPTIONS, ctx.options);
		const alias = data.ref.alias || data.ref.table;
		const pieces: Piece[] = [
			comment(alias !== '' ? 'Table data for ' + backquote(alias) : 'Query results'),
			'{| class="wikitable sortable" style="text-align:center;"' + LF
		];
		if (optBool(o, 'caption')) pieces.push(`|+'''${alias}'''` + LF);
		// Headers come from the table's columns; a raw query has no table, so no headers (as PHP).
		if (optBool(o, 'headers') && data.ref.table !== '' && data.fields.length > 0) {
			pieces.push('|-' + LF);
			for (const field of data.fields) pieces.push(' ! ' + field.name + LF);
		}
		await emit(ctx, pieces);
		for await (const row of data.rows) {
			const line: Piece[] = ['|-' + LF];
			data.fields.forEach((_field, i) => {
				// PHP concatenates NULL as an empty string.
				line.push(' | ', row[i] ?? '', LF);
			});
			await emit(ctx, line);
		}
		await ctx.write('|}' + LF + LF);
	}
};

export default mediawiki;
