/**
 * Incremental CSV parser (AbstractImportCsv / ImportCsv). Same dialect options as phpMyAdmin:
 * multi-character column separator, one-character enclosure and escape, `auto` or one-character
 * line terminator, unquoted `NULL` is SQL NULL, an escape character takes the next character
 * literally (when escape equals enclosure, a doubled enclosure is a literal enclosure).
 *
 * Feed text chunks to `push`, finish with `end`; rows come back as soon as their line is complete.
 */

import { N_ } from '#lib/i18n/translator.ts';

export interface CsvOptions {
	terminated: string;
	enclosed: string;
	escaped: string;
	/** `auto` (\r\n, \r or \n) or a single character. */
	newLine: string;
}

export const CSV_DEFAULTS: CsvOptions = {
	terminated: ',',
	enclosed: '"',
	escaped: '"',
	newLine: 'auto'
};

export interface CsvRow {
	values: (string | null)[];
	/** 1-based line number where the row starts. */
	line: number;
}

export class CsvFormatError extends Error {
	/** `msgid` is the English msgid with a `{line}` placeholder. */
	constructor(
		readonly msgid: string,
		readonly line: number
	) {
		super(msgid.replace('{line}', String(line)));
		this.name = 'CsvFormatError';
	}
}

/** Turn the literal two-character sequences `\n`, `\t`, `\r` typed in the form into control characters. */
export function unescapeCsvOption(value: string): string {
	return value.replace(/\\[ntr]/g, (m) => (m === '\\n' ? '\n' : m === '\\t' ? '\t' : '\r'));
}

/** Parameter validation of ImportCsv::buildErrorsForParams; returns the error message or null. */
export function validateCsvOptions(o: CsvOptions): string | null {
	if (o.terminated.length === 0)
		return N_('Invalid parameter for CSV import: Columns terminated with');
	if ([...o.enclosed].length > 1)
		return N_('Invalid parameter for CSV import: Columns enclosed with');
	if ([...o.escaped].length > 1)
		return N_('Invalid parameter for CSV import: Columns escaped with');
	if ([...o.newLine].length !== 1 && o.newLine !== 'auto') {
		return N_('Invalid parameter for CSV import: Lines terminated with');
	}
	return null;
}

interface Parsed {
	values: (string | null)[];
	next: number;
	blank: boolean;
}

export class CsvParser {
	private buf = '';
	private line = 1;
	private readonly o: CsvOptions;

	constructor(options: CsvOptions) {
		this.o = options;
	}

	push(chunk: string): CsvRow[] {
		this.buf += chunk;
		return this.drain(false);
	}

	end(): CsvRow[] {
		return this.drain(true);
	}

	private drain(final: boolean): CsvRow[] {
		const rows: CsvRow[] = [];
		let consumed = 0;
		while (consumed < this.buf.length) {
			const rest = consumed === 0 ? this.buf : this.buf.slice(consumed);
			const rec = this.parse(rest, final);
			if (!rec) break;
			const text = rest.slice(0, rec.next);
			if (!rec.blank) rows.push({ values: rec.values, line: this.line });
			this.line += this.countNewlines(text);
			consumed += rec.next;
		}
		this.buf = consumed === 0 ? this.buf : this.buf.slice(consumed);
		if (final) this.buf = '';
		return rows;
	}

	private countNewlines(text: string): number {
		if (this.o.newLine === 'auto') return (text.match(/\r\n|\r|\n/g) ?? []).length;
		return text.split(this.o.newLine).length - 1;
	}

	/** Length of the line terminator at `p`, 0 for none, -1 when more input is needed to decide. */
	private nl(b: string, p: number, final: boolean): number {
		const nl = this.o.newLine;
		if (nl === 'auto') {
			const c = b[p];
			if (c === '\n') return 1;
			if (c === '\r') {
				if (p + 1 >= b.length && !final) return -1;
				return b[p + 1] === '\n' ? 2 : 1;
			}
			return 0;
		}
		return b.startsWith(nl, p) ? nl.length : 0;
	}

	/** Parse one record from the start of `b`; null when the buffer ends before the record does. */
	private parse(b: string, final: boolean): Parsed | null {
		const { terminated: term, enclosed: enc, escaped: esc } = this.o;
		const len = b.length;
		const values: (string | null)[] = [];
		let p = 0;

		const first = this.nl(b, 0, final);
		if (first < 0) return null;
		if (first > 0) return { values, next: first, blank: true };

		for (;;) {
			if (p >= len) {
				if (!final) return null;
				values.push(''); // separator right before EOF: trailing empty field
				return { values, next: len, blank: false };
			}
			let value = '';
			let quoted = false;
			let end: 'term' | 'nl' | 'eof' | 'cont';
			let nlLen = 0;

			if (enc !== '' && b[p] === enc) {
				quoted = true;
				p++;
				for (;;) {
					if (p >= len) {
						if (!final) return null;
						throw new CsvFormatError(N_('Invalid format of CSV input on line {line}.'), this.line);
					}
					const ch = b[p];
					if (esc !== '' && ch === esc && esc !== enc) {
						if (p + 1 >= len) {
							if (!final) return null;
							throw new CsvFormatError(
								N_('Invalid format of CSV input on line {line}.'),
								this.line
							);
						}
						value += b[p + 1];
						p += 2;
						continue;
					}
					if (ch === enc) {
						if (p + 1 >= len && !final) return null;
						if (b[p + 1] === enc) {
							value += enc; // doubled enclosure
							p += 2;
							continue;
						}
						p++;
						break;
					}
					value += ch;
					p++;
				}
				// What follows the closing enclosure.
				if (p >= len) {
					if (!final) return null;
					end = 'eof';
				} else {
					nlLen = this.nl(b, p, final);
					if (nlLen < 0) return null;
					if (nlLen > 0) end = 'nl';
					else if (b.startsWith(term, p)) end = 'term';
					else end = 'cont'; // garbage after the closing quote starts a new field (as phpMyAdmin)
				}
			} else {
				for (;;) {
					if (p >= len) {
						if (!final) return null;
						end = 'eof';
						break;
					}
					nlLen = this.nl(b, p, final);
					if (nlLen < 0) return null;
					if (nlLen > 0) {
						end = 'nl';
						break;
					}
					if (b.startsWith(term, p)) {
						end = 'term';
						break;
					}
					const ch = b[p];
					if (esc !== '' && ch === esc) {
						if (p + 1 >= len) {
							if (!final) return null;
							value += ch;
							p++;
							continue;
						}
						if (esc === enc && (b.startsWith(term, p + 1) || this.nl(b, p + 1, final) !== 0)) {
							p++; // escape right before a separator: drop it, the separator ends the field
							continue;
						}
						value += b[p + 1];
						p += 2;
						continue;
					}
					value += ch;
					p++;
				}
			}

			values.push(!quoted && value === 'NULL' ? null : value);
			if (end === 'term') {
				p += term.length;
				continue;
			}
			if (end === 'cont') continue;
			if (end === 'nl') p += nlLen;
			return { values, next: p, blank: false };
		}
	}
}

/** Parse a complete text (tests, small inputs). */
export function parseCsv(text: string, options: CsvOptions = CSV_DEFAULTS): CsvRow[] {
	const parser = new CsvParser(options);
	return [...parser.push(text), ...parser.end()];
}
