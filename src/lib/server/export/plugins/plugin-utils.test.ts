import { describe, expect, it } from 'vitest';
import {
	htmlEscape,
	isPhpNumeric,
	localisedDate,
	phpTrim,
	replaceAll,
	resolveOptions,
	texEscape
} from './plugin-utils.ts';

describe('replaceAll', () => {
	it('replaces every occurrence of a string', () => {
		expect(replaceAll('a-b-c', '-', '+')).toBe('a+b+c');
		expect(replaceAll('abc', '', 'x')).toBe('abc');
	});

	it('is byte-exact for Buffers (no UTF-8 decoding)', () => {
		const out = replaceAll(Buffer.from([0x41, 0x22, 0xff, 0x22]), '"', '""');
		expect(out.equals(Buffer.from([0x41, 0x22, 0x22, 0xff, 0x22, 0x22]))).toBe(true);
	});
});

describe('htmlEscape', () => {
	it('escapes like htmlspecialchars with ENT_QUOTES, or ENT_COMPAT when asked', () => {
		expect(htmlEscape(`<a href="x">'&'</a>`)).toBe(
			'&lt;a href=&quot;x&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;'
		);
		expect(htmlEscape(`'"`, 'double')).toBe(`'&quot;`);
	});
});

describe('texEscape', () => {
	it('prefixes the LaTeX special characters with a backslash', () => {
		expect(texEscape('$%{}&#_^')).toBe('\\$\\%\\{\\}\\&\\#\\_\\^');
	});
});

describe('phpTrim and isPhpNumeric', () => {
	it('trims the characters PHP trim() removes', () => {
		expect(phpTrim(' \t\nx y\r\0 ')).toBe('x y');
	});

	it('accepts PHP numeric strings only', () => {
		for (const ok of ['1', '-1.5', '.5', '1e5', ' 12 ', '+3.']) expect(isPhpNumeric(ok)).toBe(true);
		for (const bad of ['', 'abc', '0x1A', '1,5', '2024-01-01'])
			expect(isPhpNumeric(bad)).toBe(false);
	});
});

describe('localisedDate', () => {
	it('uses the English phpMyAdmin default format', () => {
		expect(localisedDate(new Date(2026, 9, 28, 21, 41, 5))).toBe('October 28, 2026 at 09:41 PM');
		expect(localisedDate(new Date(2026, 0, 3, 0, 5, 0))).toBe('January 03, 2026 at 12:05 AM');
	});
});

describe('resolveOptions', () => {
	it('falls back to the defaults and coerces typed values', () => {
		const defs = [
			{ kind: 'text' as const, name: 'sep', label: '', default: ',' },
			{ kind: 'bool' as const, name: 'cols', label: '', default: true }
		];
		expect(resolveOptions(defs, {})).toEqual({ sep: ',', cols: true });
		expect(resolveOptions(defs, { sep: ';', cols: 'on' })).toEqual({ sep: ';', cols: true });
		expect(resolveOptions(defs, { cols: false })).toEqual({ sep: ',', cols: false });
	});
});
