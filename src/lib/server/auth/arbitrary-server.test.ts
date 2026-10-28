import { describe, expect, it } from 'vitest';
import { parsePhpRegex, sanitizeHost, validateArbitraryServer } from './arbitrary-server';

describe('parsePhpRegex', () => {
	it('handles delimiters and flags', () => {
		expect(parsePhpRegex('/^db\\d+\\.example\\.com$/i').test('DB1.example.com')).toBe(true);
		expect(parsePhpRegex('/^a$/').test('b')).toBe(false);
	});
	it('accepts bare patterns', () => {
		expect(parsePhpRegex('^x$').test('x')).toBe(true);
	});
});

describe('validateArbitraryServer', () => {
	it('accepts anything when no regexp is configured', () => {
		expect(validateArbitraryServer('db.example.com', '3307', '')).toEqual({
			ok: true,
			host: 'db.example.com',
			port: 3307
		});
	});
	it('strips p: prefixes', () => {
		expect(sanitizeHost('p:P:host')).toBe('host');
	});
	it('enforces ArbitraryServerRegexp', () => {
		const re = '/^(.*)\\.example\\.com$/';
		expect(validateArbitraryServer('a.example.com', undefined, re).ok).toBe(true);
		expect(validateArbitraryServer('evil.org', undefined, re)).toEqual({
			ok: false,
			error: 'You are not allowed to log in to this MySQL server!'
		});
	});
	it('rejects bad hosts and ports', () => {
		expect(validateArbitraryServer('', undefined, '').ok).toBe(false);
		expect(validateArbitraryServer('a b', undefined, '').ok).toBe(false);
		expect(validateArbitraryServer('h', '70000', '').ok).toBe(false);
		expect(validateArbitraryServer('h', 'abc', '').ok).toBe(false);
		expect(validateArbitraryServer('h', '', '')).toMatchObject({ ok: true, port: undefined });
	});
	it('treats an invalid configured regexp as a denial', () => {
		expect(validateArbitraryServer('h', undefined, '/(/').ok).toBe(false);
	});
});
