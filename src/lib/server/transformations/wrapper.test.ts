import { describe, expect, it } from 'vitest';
import { highlightSql } from '#lib/transformations/highlight.ts';
import { chooseContentType, safeFileName, sniffImage } from './wrapper.ts';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);

describe('wrapper content types', () => {
	it('sniffs images', () => {
		expect(sniffImage(png)).toBe('image/png');
		expect(sniffImage(jpg)).toBe('image/jpeg');
		expect(sniffImage(new TextEncoder().encode('GIF89a..'))).toBe('image/gif');
		expect(sniffImage(new TextEncoder().encode('<script>'))).toBeNull();
	});
	it('prefers the allow-listed requested type, then the stored media type, then the bytes', () => {
		expect(chooseContentType(png, 'image/jpeg', null)).toEqual({
			type: 'image/jpeg',
			inline: true
		});
		expect(chooseContentType(png, null, 'image_jpeg')).toEqual({
			type: 'image/jpeg',
			inline: true
		});
		expect(chooseContentType(png, null, null)).toEqual({ type: 'image/png', inline: true });
	});
	it('never serves active content inline', () => {
		const html = new TextEncoder().encode('<script>alert(1)</script>');
		expect(chooseContentType(html, 'text/html', null)).toEqual({
			type: 'application/octet-stream',
			inline: false
		});
		expect(chooseContentType(html, 'image/svg+xml', 'text_plain').inline).toBe(false);
		expect(chooseContentType(png, 'application/octet-stream', null)).toEqual({
			type: 'application/octet-stream',
			inline: false
		});
	});
	it('sanitises file names', () => {
		expect(safeFileName('../a b"c.bin', 'x')).toBe('.._a_b_c.bin');
		expect(safeFileName('', 'fallback')).toBe('fallback');
	});
});

describe('sql highlighting', () => {
	it('classifies tokens and keeps the text intact', () => {
		const tokens = highlightSql("SELECT `a`, 1 FROM t WHERE x = 'it''s' -- c");
		expect(tokens.map((t) => t.text).join('')).toBe("SELECT `a`, 1 FROM t WHERE x = 'it''s' -- c");
		expect(tokens.find((t) => t.text === 'SELECT')?.kind).toBe('keyword');
		expect(tokens.find((t) => t.text === "'it''s'")?.kind).toBe('string');
		expect(tokens.find((t) => t.text === '-- c')?.kind).toBe('comment');
	});
});
