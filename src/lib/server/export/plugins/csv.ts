/**
 * CSV export, port of libraries/classes/Plugins/Export/ExportCsv.php.
 * The writer is shared with "CSV for MS Excel" (excel.ts), as in phpMyAdmin.
 */
import { N_ } from '#lib/i18n/translator.ts';
import type {
	ExportCell,
	ExportContext,
	ExportData,
	ExportOption,
	ExportPlugin,
	ExportScope
} from '../types.ts';
import {
	emit,
	optBool,
	optString,
	phpTrim,
	type Piece,
	replaceAll,
	resolveOptions
} from './plugin-utils.ts';

export const CSV_SCOPES: ExportScope[] = ['server', 'database', 'table', 'raw'];

export const CSV_OPTIONS: ExportOption[] = [
	{ kind: 'text', name: 'separator', label: N_('Columns separated with:'), default: ',' },
	{ kind: 'text', name: 'enclosed', label: N_('Columns enclosed with:'), default: '"' },
	{ kind: 'text', name: 'escaped', label: N_('Columns escaped with:'), default: '"' },
	{ kind: 'text', name: 'terminated', label: N_('Lines terminated with:'), default: 'AUTO' },
	{ kind: 'text', name: 'null', label: N_('Replace NULL with:'), default: 'NULL' },
	{
		kind: 'bool',
		name: 'removeCRLF',
		label: N_('Remove carriage return/line feed characters within columns'),
		default: false
	},
	{ kind: 'bool', name: 'columns', label: N_('Put columns names in the first row'), default: true }
];

export interface CsvSettings {
	separator: string;
	enclosed: string;
	escaped: string;
	/** Resolved line terminator. */
	lineEnd: string;
	nullText: string;
	removeCRLF: boolean;
	columns: boolean;
	/** Excel mode: CR and CRLF inside values become LF. */
	excel: boolean;
}

/** `csv_terminated`: AUTO (or empty) means the context line ending, escapes are expanded otherwise. */
export function csvTerminator(terminated: string, crlf: string): string {
	if (terminated === '' || terminated === '0' || terminated.toLowerCase() === 'auto') return crlf;
	return terminated.split('\\r').join('\r').split('\\n').join('\n').split('\\t').join('\t');
}

/** Header line: names enclosed (only the enclosure character is doubled), trimmed like PHP. */
export function csvHeaderLine(names: readonly string[], settings: CsvSettings): string {
	let line = '';
	for (const name of names) {
		const cell =
			settings.enclosed === ''
				? name
				: settings.enclosed +
					name.split(settings.enclosed).join(settings.escaped + settings.enclosed) +
					settings.enclosed;
		line += cell + settings.separator;
	}
	return phpTrim(Array.from(line).slice(0, -1).join(''));
}

/** One data cell as pieces (ExportCsv::exportData). Empty values produce nothing, NULL the null text. */
export function csvCell(cell: ExportCell, settings: CsvSettings): Piece[] {
	if (cell === null) return [settings.nullText];
	if (cell.length === 0) return [];
	let value: Piece = cell;
	if (settings.excel) {
		value = replaceAll(replaceAll(value, '\r\n', '\n'), '\r', '\n');
	}
	if (settings.removeCRLF) {
		value = replaceAll(replaceAll(value, '\r', ''), '\n', '');
	}
	if (settings.enclosed === '') return [value];
	const body =
		settings.escaped !== settings.enclosed
			? replaceAll(
					replaceAll(value, settings.escaped, settings.escaped + settings.escaped),
					settings.enclosed,
					settings.escaped + settings.enclosed
				)
			: replaceAll(value, settings.enclosed, settings.escaped + settings.enclosed);
	return [settings.enclosed, body, settings.enclosed];
}

/** Write one table: optional header row, then one line per row. */
export async function writeCsv(
	ctx: ExportContext,
	data: ExportData,
	settings: CsvSettings
): Promise<void> {
	if (settings.columns) {
		const names = data.fields.map((field) => field.name);
		await ctx.write(csvHeaderLine(names, settings) + settings.lineEnd);
	}
	const last = data.fields.length - 1;
	for await (const row of data.rows) {
		const pieces: Piece[] = [];
		for (let j = 0; j <= last; j++) {
			pieces.push(...csvCell(row[j] ?? null, settings));
			if (j < last) pieces.push(settings.separator);
		}
		pieces.push(settings.lineEnd);
		await emit(ctx, pieces);
	}
}

const csv: ExportPlugin = {
	id: 'csv',
	label: N_('CSV'),
	extension: 'csv',
	mimeType: 'text/comma-separated-values',
	scopes: CSV_SCOPES,
	supports: { structure: false, data: true },
	options: CSV_OPTIONS,
	async data(ctx, data) {
		const o = resolveOptions(CSV_OPTIONS, ctx.options);
		await writeCsv(ctx, data, {
			// phpMyAdmin: str_replace('\\t', "\011", $csv_separator)
			separator: optString(o, 'separator').split('\\t').join('\t'),
			enclosed: optString(o, 'enclosed'),
			escaped: optString(o, 'escaped'),
			lineEnd: csvTerminator(optString(o, 'terminated'), ctx.crlf),
			nullText: optString(o, 'null'),
			removeCRLF: optBool(o, 'removeCRLF'),
			columns: optBool(o, 'columns'),
			excel: false
		});
	}
};

export default csv;
