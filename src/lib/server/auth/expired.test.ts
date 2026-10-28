import { describe, expect, it } from 'vitest';
import { expiredLoginLocation } from './expired';

describe('expiredLoginLocation', () => {
	it('keeps the page the user was on for GET requests', () => {
		expect(expiredLoginLocation('GET', new URL('http://x/server/databases?a=1'))).toBe(
			'/login?expired=1&redirect=%2Fserver%2Fdatabases%3Fa%3D1'
		);
	});
	it('does not redirect back for POST, home or login', () => {
		expect(expiredLoginLocation('POST', new URL('http://x/db/a/structure'))).toBe(
			'/login?expired=1'
		);
		expect(expiredLoginLocation('GET', new URL('http://x/'))).toBe('/login?expired=1');
	});
});
