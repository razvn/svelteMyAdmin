import { describe, expect, it } from 'vitest';
import { resolveClientIp } from './client-ip';

const h = (o: Record<string, string>) => new Headers(o);

describe('resolveClientIp', () => {
	it('returns the direct address by default', () => {
		expect(resolveClientIp('10.0.0.5', h({ 'x-forwarded-for': '1.2.3.4' }), {})).toBe('10.0.0.5');
	});
	it('unwraps IPv4-mapped addresses', () => {
		expect(resolveClientIp('::ffff:10.0.0.5', h({}), {})).toBe('10.0.0.5');
	});
	it('uses the first value of the header for trusted proxies', () => {
		const tp = { '10.0.0.1': 'X-Forwarded-For' };
		expect(resolveClientIp('10.0.0.1', h({ 'x-forwarded-for': '1.2.3.4, 10.0.0.9' }), tp)).toBe(
			'1.2.3.4'
		);
	});
	it('returns null for an invalid forwarded value or a missing header', () => {
		const tp = { '10.0.0.1': 'X-Forwarded-For' };
		expect(resolveClientIp('10.0.0.1', h({ 'x-forwarded-for': 'garbage' }), tp)).toBeNull();
		expect(resolveClientIp('10.0.0.1', h({}), tp)).toBeNull();
	});
	it('returns null without an address', () => {
		expect(resolveClientIp(undefined, h({}), {})).toBeNull();
	});
});
