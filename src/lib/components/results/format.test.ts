import { describe, expect, it } from 'vitest';
import { binaryTitle, cellText, formatBinary, prettyJson, truncate } from './format.ts';

describe('formatBinary', () => {
	it('prints small sizes in bytes', () => {
		expect(formatBinary({ bytes: 12, preview: '' })).toBe('[BLOB - 12 B]');
		expect(formatBinary({ bytes: 0, preview: '' })).toBe('[BLOB - 0 B]');
	});
	it('uses binary units from 1 KiB', () => {
		expect(formatBinary({ bytes: 1536, preview: '' })).toBe('[BLOB - 1.5 KiB]');
	});
	it('shows a hex title, with an ellipsis when cut', () => {
		expect(binaryTitle({ bytes: 2, preview: 'dead' })).toBe('0xDEAD');
		expect(binaryTitle({ bytes: 100, preview: 'dead' })).toBe('0xDEAD…');
	});
});

describe('truncate', () => {
	it('keeps short text', () => {
		expect(truncate('abc', 5)).toEqual({ text: 'abc', truncated: false });
	});
	it('cuts long text', () => {
		expect(truncate('abcdef', 3)).toEqual({ text: 'abc', truncated: true });
	});
	it('does not truncate when the limit is 0', () => {
		expect(truncate('abcdef', 0).truncated).toBe(false);
	});
	it('counts code points', () => {
		expect(truncate('😀😀😀', 3).truncated).toBe(false);
		expect(truncate('😀😀😀', 2).text).toBe('😀😀');
	});
});

describe('prettyJson', () => {
	it('indents valid JSON', () => {
		expect(prettyJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
	});
	it('returns null for invalid JSON', () => {
		expect(prettyJson('{nope')).toBeNull();
	});
});

describe('cellText', () => {
	it('renders NULL, text and binary', () => {
		expect(cellText(null)).toBe('NULL');
		expect(cellText('x')).toBe('x');
		expect(cellText({ bytes: 3, preview: '010203' })).toBe('[BLOB - 3 B]');
	});
});
