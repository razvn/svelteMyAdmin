/**
 * Format specific import options (the `getProperties()` of libraries/classes/Plugins/Import/*) and the
 * `$cfg['Import']` defaults. Shared by the page (rendering) and the server (parsing).
 */
import type { ImportFormat, ImportOptionValues } from './types.ts';

export type ImportLevel = 'server' | 'db' | 'table';

export interface OptionDef {
	/** Posted name; the config key is `<format>_<name>`. */
	name: string;
	label: string;
	kind: 'bool' | 'text' | 'number' | 'select';
	default: string | boolean | number;
	choices?: { value: string; label: string }[];
	/** Levels at which the option exists (default: all). */
	levels?: ImportLevel[];
	help?: string;
	/** Short input (one or two characters). */
	short?: boolean;
}

const SQL_MODES_ALL = [
	'NONE',
	'ANSI',
	'DB2',
	'MAXDB',
	'MYSQL323',
	'MYSQL40',
	'MSSQL',
	'ORACLE',
	'TRADITIONAL'
];
/** MySQL 8 dropped the legacy combination modes. */
const SQL_MODES_MYSQL8 = ['NONE', 'ANSI', 'TRADITIONAL'];

export const sqlCompatibilities = (mysql8: boolean): string[] =>
	mysql8 ? SQL_MODES_MYSQL8 : SQL_MODES_ALL;

const csvCommon = (prefix: 'csv' | 'ldi'): OptionDef[] => [
	{
		name: 'replace',
		label: 'Update data when duplicate keys found on import (add ON DUPLICATE KEY UPDATE)',
		kind: 'bool',
		default: false
	},
	{
		name: 'terminated',
		label: 'Columns separated with:',
		kind: 'text',
		default: prefix === 'csv' ? ',' : ';',
		short: true
	},
	{ name: 'enclosed', label: 'Columns enclosed with:', kind: 'text', default: '"', short: true },
	{
		name: 'escaped',
		label: 'Columns escaped with:',
		kind: 'text',
		default: prefix === 'csv' ? '"' : '\\',
		short: true
	},
	{ name: 'new_line', label: 'Lines terminated with:', kind: 'text', default: 'auto', short: true }
];

export const FORMAT_OPTIONS: Record<ImportFormat, OptionDef[]> = {
	sql: [
		{ name: 'compatibility', label: 'SQL compatibility mode:', kind: 'select', default: 'NONE' },
		{
			name: 'no_auto_value_on_zero',
			label: 'Do not use AUTO_INCREMENT for zero values',
			kind: 'bool',
			default: true
		}
	],
	csv: [
		{
			name: 'truncate',
			label: 'Replace table data with file (TRUNCATE the table first)',
			kind: 'bool',
			default: false,
			levels: ['table']
		},
		...csvCommon('csv'),
		{
			name: 'new_db_name',
			label: 'Name of the new database (optional):',
			kind: 'text',
			default: '',
			levels: ['server']
		},
		{
			name: 'new_tbl_name',
			label: 'Name of the new table (optional):',
			kind: 'text',
			default: '',
			levels: ['server', 'db']
		},
		{
			name: 'partial_import',
			label: 'Import these many number of rows (optional):',
			kind: 'number',
			default: 0
		},
		{
			name: 'col_names',
			label:
				'The first line of the file contains the table column names (if this is unchecked, the first line will become part of the data)',
			kind: 'bool',
			default: false
		},
		{
			name: 'columns',
			label: 'Column names:',
			kind: 'text',
			default: '',
			levels: ['table'],
			help: 'If the data in each row of the file is not in the same order as in the database, list the corresponding column names here. Column names must be separated by commas and not enclosed in quotations.'
		},
		{
			name: 'ignore',
			label: 'Do not abort on INSERT error',
			kind: 'bool',
			default: false,
			levels: ['table']
		}
	],
	ldi: [
		...csvCommon('ldi'),
		{ name: 'columns', label: 'Column names:', kind: 'text', default: '' },
		{ name: 'ignore', label: 'Do not abort on INSERT error', kind: 'bool', default: false },
		{ name: 'local_option', label: 'Use LOCAL keyword', kind: 'bool', default: false }
	],
	ods: [
		{
			name: 'col_names',
			label:
				'The first line of the file contains the table column names (if this is unchecked, the first line will become part of the data)',
			kind: 'bool',
			default: false
		},
		{ name: 'empty_rows', label: 'Do not import empty rows', kind: 'bool', default: true },
		{
			name: 'recognize_percentages',
			label: 'Import percentages as proper decimals (ex. 12.00% to .12)',
			kind: 'bool',
			default: true
		},
		{
			name: 'recognize_currency',
			label: 'Import currencies (ex. $5.00 to 5.00)',
			kind: 'bool',
			default: true
		}
	],
	xml: [],
	mediawiki: []
};

/** Options of a format at a level. */
export function optionsFor(format: ImportFormat, level: ImportLevel): OptionDef[] {
	return FORMAT_OPTIONS[format].filter((o) => !o.levels || o.levels.includes(level));
}

/** `$cfg['Import']` defaults (config.default.php). */
export const IMPORT_CONFIG_DEFAULTS = {
	format: 'sql',
	charset: '',
	allow_interrupt: true,
	skip_queries: 0
} as const;

/** Option defaults of a format, overridden by `$cfg['Import']['<format>_<name>']`. */
export function defaultOptionValues(
	format: ImportFormat,
	level: ImportLevel,
	cfg: Record<string, unknown> = {}
): ImportOptionValues {
	const out: ImportOptionValues = {};
	for (const o of optionsFor(format, level)) {
		const v = cfg[`${format}_${o.name}`];
		if (o.kind === 'bool') out[o.name] = typeof v === 'boolean' ? v : (o.default as boolean);
		else if (o.kind === 'number') out[o.name] = typeof v === 'number' ? v : (o.default as number);
		else out[o.name] = typeof v === 'string' ? v : (o.default as string);
	}
	return out;
}

/** Charsets offered for the file (value is a WHATWG encoding label). */
export const FILE_CHARSETS: { value: string; label: string }[] = [
	{ value: 'utf-8', label: 'utf-8' },
	{ value: 'utf-16le', label: 'utf-16le' },
	{ value: 'utf-16be', label: 'utf-16be' },
	{ value: 'iso-8859-1', label: 'iso-8859-1 (latin1)' },
	{ value: 'iso-8859-2', label: 'iso-8859-2 (latin2)' },
	{ value: 'iso-8859-15', label: 'iso-8859-15 (latin9)' },
	{ value: 'windows-1250', label: 'windows-1250 (cp1250)' },
	{ value: 'windows-1251', label: 'windows-1251 (cp1251)' },
	{ value: 'windows-1252', label: 'windows-1252 (cp1252)' },
	{ value: 'windows-1257', label: 'windows-1257 (cp1257)' },
	{ value: 'koi8-r', label: 'koi8-r' },
	{ value: 'gb18030', label: 'gb18030' },
	{ value: 'big5', label: 'big5' },
	{ value: 'shift_jis', label: 'shift_jis (sjis)' },
	{ value: 'euc-jp', label: 'euc-jp (ujis)' },
	{ value: 'euc-kr', label: 'euc-kr' }
];
