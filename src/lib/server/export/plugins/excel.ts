/**
 * "CSV for MS Excel" export, port of libraries/classes/Plugins/Export/ExportExcel.php
 * (which extends ExportCsv). Lines end with CRLF, enclosure is `"`, the separator depends on
 * the edition. No byte order mark is written, as in phpMyAdmin 5.2.3.
 */
import type { ExportOption, ExportPlugin } from '../types.ts';
import { CSV_SCOPES, writeCsv } from './csv.ts';
import { optBool, optString, resolveOptions } from './plugin-utils.ts';

export const EXCEL_OPTIONS: ExportOption[] = [
	{ kind: 'text', name: 'null', label: 'Replace NULL with:', default: 'NULL' },
	{
		kind: 'bool',
		name: 'removeCRLF',
		label: 'Remove carriage return/line feed characters within columns',
		default: false
	},
	{ kind: 'bool', name: 'columns', label: 'Put columns names in the first row', default: true },
	{
		kind: 'select',
		name: 'edition',
		label: 'Excel edition:',
		default: 'win',
		choices: [
			{ value: 'win', label: 'Windows' },
			{ value: 'mac_excel2003', label: 'Excel 2003 / Macintosh' },
			{ value: 'mac_excel2008', label: 'Excel 2008 / Macintosh' }
		]
	}
];

/** Separator per edition (ExportExcel / ExportCsv::exportHeader). */
const EDITION_SEPARATOR: Record<string, string> = {
	win: ';',
	mac_excel2003: ';',
	mac_excel2008: ','
};

const excel: ExportPlugin = {
	id: 'excel',
	label: 'CSV for MS Excel',
	extension: 'csv',
	mimeType: 'text/comma-separated-values',
	scopes: CSV_SCOPES,
	supports: { structure: false, data: true },
	crlf: '\r\n',
	options: EXCEL_OPTIONS,
	async data(ctx, data) {
		const o = resolveOptions(EXCEL_OPTIONS, ctx.options);
		const edition = optString(o, 'edition');
		await writeCsv(ctx, data, {
			separator: EDITION_SEPARATOR[edition] ?? ',',
			enclosed: '"',
			escaped: '"',
			lineEnd: '\r\n',
			nullText: optString(o, 'null'),
			removeCRLF: optBool(o, 'removeCRLF'),
			columns: optBool(o, 'columns'),
			excel: true
		});
	}
};

export default excel;
