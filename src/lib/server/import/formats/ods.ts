/**
 * OpenDocument Spreadsheet reader (Plugins/Import/ImportOds.php): sheets become tables, the first
 * row can name the columns, trailing empty cells are dropped, short rows are padded with NULL.
 */
import { N_ } from '#lib/i18n/translator.ts';
import { strFromU8, unzipSync } from 'fflate';
import { columnAlphaName } from '../analyze.ts';
import { elementChildren, localName, parseXml, XmlError, type XmlElement } from './xml.ts';

export interface OdsOptions {
	/** The first row holds the column names. */
	colNames: boolean;
	/** Do not import rows that are entirely empty. */
	emptyRows: boolean;
	/** `12.00%` imported as `0.12`. */
	recognizePercentages: boolean;
	/** `$5.00` imported as `5`. */
	recognizeCurrency: boolean;
}

export const ODS_DEFAULTS: OdsOptions = {
	colNames: false,
	emptyRows: true,
	recognizePercentages: true,
	recognizeCurrency: true
};

export interface ParsedTable {
	name: string;
	colNames: string[];
	rows: (string | null)[][];
}

export class OdsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OdsError';
	}
}

/** Largest content.xml we are willing to inflate (zip bomb guard). */
const MAX_CONTENT_BYTES = 512 * 1024 * 1024;

export function extractOdsContent(bytes: Uint8Array): string {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter: (f) => f.name === 'content.xml' && f.originalSize <= MAX_CONTENT_BYTES
		});
	} catch {
		throw new OdsError(N_('The file is not a valid OpenDocument Spreadsheet (not a ZIP archive).'));
	}
	const content = files['content.xml'];
	if (!content) throw new OdsError(N_('Could not parse OpenDocument Spreadsheet!'));
	return strFromU8(content);
}

function paragraphText(el: XmlElement): string {
	let out = '';
	for (const c of el.children) {
		if (typeof c === 'string') {
			out += c;
			continue;
		}
		const n = localName(c.name);
		if (n === 's') out += ' '.repeat(Math.max(1, parseInt(c.attrs['text:c'] ?? '1', 10) || 1));
		else if (n === 'tab') out += '\t';
		else if (n === 'line-break') out += '\n';
		else out += paragraphText(c);
	}
	return out;
}

function cellValue(cell: XmlElement, o: OdsOptions): string {
	const type = cell.attrs['office:value-type'];
	if (
		(o.recognizePercentages && type === 'percentage') ||
		(o.recognizeCurrency && type === 'currency')
	) {
		const v = parseFloat(cell.attrs['office:value'] ?? '');
		return String(Number.isNaN(v) ? 0 : v);
	}
	const paras = elementChildren(cell).filter((c) => c.name === 'text:p');
	return paras.map(paragraphText).join('\n');
}

const MAX_REPEAT = 16384;

/** Parse the `content.xml` of a spreadsheet. */
export function parseOdsContent(xml: string, options: Partial<OdsOptions> = {}): ParsedTable[] {
	const o = { ...ODS_DEFAULTS, ...options };
	let root: XmlElement;
	try {
		root = parseXml(xml);
	} catch (e) {
		if (e instanceof XmlError) {
			throw new OdsError(
				'The XML file specified was either malformed or incomplete. Please correct the issue and try again.'
			);
		}
		throw e;
	}
	const body = elementChildren(root).find((c) => c.name === 'office:body');
	const sheetsRoot = body && elementChildren(body).find((c) => c.name === 'office:spreadsheet');
	if (!sheetsRoot) throw new OdsError(N_('Could not parse OpenDocument Spreadsheet!'));

	const tables: ParsedTable[] = [];
	for (const sheet of elementChildren(sheetsRoot)) {
		if (sheet.name !== 'table:table') continue;
		let colNames: string[] = [];
		const rows: (string | null)[][] = [];
		let maxCols = 0;
		let firstRow = o.colNames;

		for (const row of elementChildren(sheet)) {
			if (row.name !== 'table:table-row') continue;
			const cells = elementChildren(row);
			const values: (string | null)[] = [];
			cells.forEach((cell, idx) => {
				const repeat = Math.min(
					MAX_REPEAT,
					parseInt(cell.attrs['table:number-columns-repeated'] ?? '', 10) || 1
				);
				const hasText =
					cell.name === 'table:table-cell' &&
					cell.children.some((c) => typeof c !== 'string' && c.name === 'text:p');
				if (hasText) {
					for (let k = 0; k < repeat; k++) values.push(cellValue(cell, o));
				} else if (idx !== cells.length - 1) {
					// Empty cells in the middle of a row; trailing empty repeats are dropped.
					for (let k = 0; k < repeat; k++) values.push(null);
				}
			});

			if (values.length > maxCols) maxCols = values.length;
			if (firstRow) {
				colNames = values.map((v, k) => (v === null ? columnAlphaName(k + 1) : v.trimEnd()));
				firstRow = false;
				continue;
			}
			if (o.emptyRows && values.every((v) => v === null)) continue;
			rows.push(values);
		}

		if (rows.length === 0 || rows[0].length === 0) continue; // empty sheet
		for (let k = colNames.length; k < maxCols; k++) colNames.push(columnAlphaName(k + 1));
		for (const r of rows) while (r.length < maxCols) r.push(null);
		tables.push({
			name: sheet.attrs['table:name'] ?? `Sheet ${tables.length + 1}`,
			colNames,
			rows
		});
	}
	return tables;
}

export function parseOds(bytes: Uint8Array, options: Partial<OdsOptions> = {}): ParsedTable[] {
	return parseOdsContent(extractOdsContent(bytes), options);
}
