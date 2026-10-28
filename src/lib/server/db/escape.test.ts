import { describe, expect, it } from 'vitest';
import { escapeId, escapeLike, escapeQualified, escapeString, quoteValue } from './escape';

describe('escapeId', () => {
	it('wraps in backticks', () => {
		expect(escapeId('users')).toBe('`users`');
	});
	it('doubles embedded backticks', () => {
		expect(escapeId('we`ird')).toBe('`we``ird`');
		expect(escapeId('``')).toBe('``````');
	});
	it('keeps dots, spaces and unicode inside one identifier', () => {
		expect(escapeId('a.b c')).toBe('`a.b c`');
		expect(escapeId('tëst_日本')).toBe('`tëst_日本`');
	});
	it('neutralises injection attempts', () => {
		expect(escapeId('x`; DROP TABLE y; --')).toBe('`x``; DROP TABLE y; --`');
	});
	it('rejects empty names and NUL', () => {
		expect(() => escapeId('')).toThrow();
		expect(() => escapeId('a\0b')).toThrow();
	});
	it('rejects non-strings', () => {
		expect(() => escapeId(1 as unknown as string)).toThrow(TypeError);
	});
});

describe('escapeQualified', () => {
	it('joins parts with dots', () => {
		expect(escapeQualified('db', 'tbl')).toBe('`db`.`tbl`');
		expect(escapeQualified('db', 'tbl', 'col')).toBe('`db`.`tbl`.`col`');
	});
	it('escapes each part separately', () => {
		expect(escapeQualified('d.b', 'ta`b')).toBe('`d.b`.`ta``b`');
	});
	it('requires at least one part', () => {
		expect(() => escapeQualified()).toThrow();
	});
});

describe('escapeString', () => {
	it('leaves plain text alone', () => {
		expect(escapeString('hello world')).toBe('hello world');
		expect(escapeString('')).toBe('');
	});
	it.each([
		["'", "\\'"],
		['"', '\\"'],
		['\\', '\\\\'],
		['\n', '\\n'],
		['\r', '\\r'],
		['\0', '\\0'],
		['\x1a', '\\Z']
	])('escapes %j', (input, expected) => {
		expect(escapeString(input)).toBe(expected);
	});
	it('escapes the backslash before quotes (no double processing)', () => {
		expect(escapeString("\\'")).toBe("\\\\\\'");
		expect(escapeString("O'Reilly")).toBe("O\\'Reilly");
	});
	it('does not touch tabs or unicode', () => {
		expect(escapeString('a\tb ü 日本')).toBe('a\tb ü 日本');
	});
});

describe('escapeLike', () => {
	it('escapes wildcards', () => {
		expect(escapeLike('50%_off')).toBe('50\\\\%\\\\_off');
	});
	it('also string-escapes quotes', () => {
		expect(escapeLike("it's")).toBe("it\\'s");
	});
});

describe('quoteValue', () => {
	it('handles null and undefined', () => {
		expect(quoteValue(null)).toBe('NULL');
		expect(quoteValue(undefined)).toBe('NULL');
	});
	it('quotes strings', () => {
		expect(quoteValue("a'b")).toBe("'a\\'b'");
		expect(quoteValue('')).toBe("''");
	});
	it('numbers are verbatim', () => {
		expect(quoteValue(42)).toBe('42');
		expect(quoteValue(-1.5)).toBe('-1.5');
		expect(quoteValue(9007199254740993n)).toBe('9007199254740993');
	});
	it('rejects NaN/Infinity', () => {
		expect(() => quoteValue(NaN)).toThrow();
		expect(() => quoteValue(Infinity)).toThrow();
	});
	it('booleans', () => {
		expect(quoteValue(true)).toBe('1');
		expect(quoteValue(false)).toBe('0');
	});
	it('buffers become hex literals', () => {
		expect(quoteValue(Buffer.from([0, 255, 16]))).toBe("X'00ff10'");
		expect(quoteValue(new Uint8Array([1, 2]))).toBe("X'0102'");
		expect(quoteValue(Buffer.alloc(0))).toBe("X''");
	});
	it('dates are formatted in UTC', () => {
		expect(quoteValue(new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 6)))).toBe(
			"'2024-01-02 03:04:05.006'"
		);
		expect(() => quoteValue(new Date('nope'))).toThrow();
	});
	it('rejects unsupported types', () => {
		expect(() => quoteValue({} as never)).toThrow(TypeError);
	});
});
