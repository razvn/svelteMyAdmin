import { describe, expect, it } from 'vitest';
import { safeRedirectTarget } from './redirect';

describe('safeRedirectTarget', () => {
	it('keeps relative paths with query and hash', () => {
		expect(safeRedirectTarget('/server/databases')).toBe('/server/databases');
		expect(safeRedirectTarget('/db/x/structure?a=1#h')).toBe('/db/x/structure?a=1#h');
	});
	it('rejects external and protocol-relative targets', () => {
		for (const t of [
			'https://evil.example',
			'//evil.example',
			'/\\evil.example',
			'\\\\evil.example',
			'javascript:alert(1)',
			'evil',
			'/\t/evil.example',
			'/\nfoo'
		]) {
			expect(safeRedirectTarget(t)).toBe('/');
		}
	});
	it('rejects missing or non-string input and login loops', () => {
		expect(safeRedirectTarget(undefined)).toBe('/');
		expect(safeRedirectTarget(null)).toBe('/');
		expect(safeRedirectTarget('')).toBe('/');
		expect(safeRedirectTarget('/login?redirect=/x')).toBe('/');
		expect(safeRedirectTarget('/logout')).toBe('/');
	});
	it('uses the given fallback', () => {
		expect(safeRedirectTarget('//x', '/home')).toBe('/home');
	});
});
