import { describe, expect, it } from 'vitest';
import {
	CsvFormatError,
	CsvParser,
	parseCsv,
	unescapeCsvOption,
	validateCsvOptions,
	type CsvOptions
} from './csv.ts';

const vals = (text: string, o?: Partial<CsvOptions>) =>
	parseCsv(text, { terminated: ',', enclosed: '"', escaped: '"', newLine: 'auto', ...o }).map(
		(r) => r.values
	);

describe('parseCsv', () => {
	it('parses plain rows with any line ending and a missing final newline', () => {
		expect(vals('a,b\n1,2\r\n3,4\r5,6')).toEqual([
			['a', 'b'],
			['1', '2'],
			['3', '4'],
			['5', '6']
		]);
	});

	it('handles quotes, doubled quotes and embedded separators / newlines', () => {
		expect(vals('"a,b","he said ""hi""","line1\nline2"\n')).toEqual([
			['a,b', 'he said "hi"', 'line1\nline2']
		]);
	});

	it('empty fields and trailing separator', () => {
		expect(vals('a,,c\n,\n')).toEqual([
			['a', '', 'c'],
			['', '']
		]);
		expect(vals('a,')).toEqual([['a', '']]);
	});

	it('unquoted NULL is null, quoted "NULL" is text', () => {
		expect(vals('NULL,"NULL",null\n')).toEqual([[null, 'NULL', 'null']]);
	});

	it('skips blank lines', () => {
		expect(vals('a\n\nb\n\n')).toEqual([['a'], ['b']]);
	});

	it('custom separator, multi-character separator and tab', () => {
		expect(vals('a;b;c\n', { terminated: ';' })).toEqual([['a', 'b', 'c']]);
		expect(vals('a||b||c\n', { terminated: '||' })).toEqual([['a', 'b', 'c']]);
		expect(vals('a\tb\n', { terminated: '\t' })).toEqual([['a', 'b']]);
	});

	it('backslash escape differs from the enclosure', () => {
		expect(vals('"a\\"b",c\\,d\n', { escaped: '\\' })).toEqual([['a"b', 'c,d']]);
	});

	it('no enclosure', () => {
		expect(vals('"a",b\n', { enclosed: '', escaped: '' })).toEqual([['"a"', 'b']]);
	});

	it('custom line terminator keeps newlines inside values', () => {
		expect(vals('a,b|c\nd,e|', { newLine: '|' })).toEqual([
			['a', 'b'],
			['c\nd', 'e']
		]);
	});

	it('reports row start lines (including multi-line quoted fields)', () => {
		const rows = parseCsv('a\n"x\ny"\n\nb\n');
		expect(rows.map((r) => r.line)).toEqual([1, 2, 5]);
	});

	it('throws on an unterminated quote with the line number', () => {
		expect(() => parseCsv('a\n"oops,b\n')).toThrow(CsvFormatError);
		try {
			parseCsv('a\n"oops,b\n');
		} catch (e) {
			expect((e as CsvFormatError).line).toBe(2);
		}
	});

	it('is chunk-size independent', () => {
		const text = 'id,name,note\r\n1,"Smith, J.","said ""x""\r\nnext"\r\n2,,NULL\r\n3,a||b,end';
		const whole = parseCsv(text);
		for (let size = 1; size < text.length; size++) {
			const p = new CsvParser({ terminated: ',', enclosed: '"', escaped: '"', newLine: 'auto' });
			const rows = [];
			for (let i = 0; i < text.length; i += size) rows.push(...p.push(text.slice(i, i + size)));
			rows.push(...p.end());
			expect(rows, `chunk ${size}`).toEqual(whole);
		}
	});
});

describe('options', () => {
	it('unescapes \\n \\t \\r', () => {
		expect(unescapeCsvOption('\\t')).toBe('\t');
		expect(unescapeCsvOption('\\n')).toBe('\n');
		expect(unescapeCsvOption(';')).toBe(';');
	});
	it('validates', () => {
		const ok = { terminated: ',', enclosed: '"', escaped: '"', newLine: 'auto' };
		expect(validateCsvOptions(ok)).toBeNull();
		expect(validateCsvOptions({ ...ok, terminated: '' })).toContain('Columns terminated with');
		expect(validateCsvOptions({ ...ok, enclosed: 'ab' })).toContain('Columns enclosed with');
		expect(validateCsvOptions({ ...ok, escaped: 'ab' })).toContain('Columns escaped with');
		expect(validateCsvOptions({ ...ok, newLine: 'ab' })).toContain('Lines terminated with');
	});
});
