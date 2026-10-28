import { describe, expect, it } from 'vitest';
import { GENERIC_LOGIN_ERROR, isAccessDenied, mapConnectError } from './errors';

describe('mapConnectError', () => {
	it('maps access denied', () => {
		const e = Object.assign(new Error("Access denied for user 'x'"), {
			errno: 1045,
			code: 'ER_ACCESS_DENIED_ERROR'
		});
		expect(mapConnectError(e)).toBe('Cannot log in to the MySQL server');
		expect(isAccessDenied(e)).toBe(true);
	});
	it('maps network errors without leaking details', () => {
		const e = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306 at stack...'), {
			code: 'ECONNREFUSED'
		});
		expect(mapConnectError(e)).toBe('mysqli::real_connect(): (HY000/2002): Connection refused');
		expect(mapConnectError(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toMatch(
			/getaddrinfo failed/
		);
	});
	it('falls back to the generic message', () => {
		expect(mapConnectError(new Error('boom'))).toBe(GENERIC_LOGIN_ERROR);
		expect(mapConnectError(undefined)).toBe(GENERIC_LOGIN_ERROR);
	});
	it('honours hide_connection_errors', () => {
		expect(mapConnectError({ code: 'ECONNREFUSED' }, true)).toBe(GENERIC_LOGIN_ERROR);
	});
});
