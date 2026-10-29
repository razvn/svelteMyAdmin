/**
 * PHP array export, port of libraries/classes/Plugins/Export/ExportPhparray.php.
 * Each table becomes `$table = array(array('col' => 'value', ...), ...);`.
 */
import { N_ } from '#lib/i18n/translator.ts';
import type { ExportCell, ExportPlugin, ExportScope } from '../types.ts';
import { backquote, emit, type Piece, replaceAll } from './plugin-utils.ts';

const PHPARRAY_SCOPES: ExportScope[] = ['server', 'database', 'table', 'raw'];

/**
 * PHP's strtr with a two-character search and a one-character replacement: only the star
 * becomes a dash, the slash is ignored. Kept to match phpMyAdmin's output.
 */
export function commentString(value: string): string {
	return value.split('*').join('-');
}

/** `var_export($value, true)` for a string or NULL. */
export function varExportValue(cell: ExportCell): Piece[] {
	if (cell === null) return ['NULL'];
	let value: Piece = replaceAll(cell, '\\', '\\\\');
	value = replaceAll(value, "'", "\\'");
	value = replaceAll(value, '\0', '\' . "\\0" . \'');
	return ["'", value, "'"];
}

/** Variable name for a table, as PHP fixes it (invalid characters become `_`). */
export function phpVariableName(table: string): string {
	if (/^[a-zA-Z_\x7f-\uffff][a-zA-Z0-9_\x7f-\uffff]*$/.test(table)) return table;
	let fixed = table.replace(/[^a-zA-Z0-9_\x7f-\uffff]/g, '_');
	if (!/^[a-zA-Z_\x7f-\uffff]/.test(fixed)) fixed = '_' + fixed;
	return fixed;
}

const phparray: ExportPlugin = {
	id: 'phparray',
	label: N_('PHP array'),
	extension: 'php',
	mimeType: 'text/plain',
	scopes: PHPARRAY_SCOPES,
	supports: { structure: false, data: true },
	options: [],

	async header(ctx) {
		const crlf = ctx.crlf;
		await ctx.write(
			'<?php' +
				crlf +
				'/**' +
				crlf +
				' * Export to PHP Array plugin for svelteMyAdmin' +
				crlf +
				` * @version ${ctx.appVersion}` +
				crlf +
				' */' +
				crlf +
				crlf
		);
	},

	async dbHeader(ctx, db, alias) {
		const crlf = ctx.crlf;
		await ctx.write(
			'/**' + crlf + ' * Database ' + commentString(backquote(alias || db)) + crlf + ' */' + crlf
		);
	},

	async data(ctx, data) {
		const crlf = ctx.crlf;
		const alias = data.ref.alias || data.ref.table;
		const variable = phpVariableName(alias);
		await emit(ctx, [
			crlf +
				'/* ' +
				commentString(backquote(data.ref.db)) +
				'.' +
				commentString(backquote(alias)) +
				' */' +
				crlf +
				'$' +
				variable +
				' = array('
		]);
		let count = 0;
		for await (const row of data.rows) {
			const pieces: Piece[] = [count === 0 ? crlf + '  array(' : ',' + crlf + '  array('];
			data.fields.forEach((field, i) => {
				pieces.push(...varExportValue(field.name));
				pieces.push(' => ');
				pieces.push(...varExportValue(row[i] ?? null));
				if (i + 1 < data.fields.length) pieces.push(',');
			});
			pieces.push(')');
			await emit(ctx, pieces);
			count++;
		}
		await ctx.write(crlf + ');' + crlf);
	}
};

export default phparray;
