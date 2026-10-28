import { describe, expect, it, vi } from 'vitest';
import {
	applyConnectionCollation,
	buildConnectionOptions,
	isValidCollationName
} from './connection';

const base = {
	host: 'db.example',
	port: 0,
	socket: '',
	ssl: false,
	ssl_ca: null,
	ssl_cert: null,
	ssl_key: null,
	ssl_ciphers: null,
	ssl_verify: true,
	compress: false
};

describe('buildConnectionOptions', () => {
	it('uses safe defaults', () => {
		const o = buildConnectionOptions(base, 'u', 'p');
		expect(o).toMatchObject({
			host: 'db.example',
			user: 'u',
			password: 'p',
			multipleStatements: false,
			dateStrings: true,
			supportBigNumbers: true,
			bigNumberStrings: true
		});
		expect(o.port).toBeUndefined();
		expect(o.ssl).toBeUndefined();
	});
	it('uses port when set and socket in preference to host', () => {
		expect(buildConnectionOptions({ ...base, port: 3307 }, 'u', 'p').port).toBe(3307);
		const o = buildConnectionOptions({ ...base, socket: '/tmp/mysql.sock' }, 'u', 'p');
		expect(o.socketPath).toBe('/tmp/mysql.sock');
		expect(o.host).toBeUndefined();
	});
	it('enables ssl and honours ssl_verify', () => {
		const o = buildConnectionOptions({ ...base, ssl: true, ssl_verify: false }, 'u', 'p');
		expect(o.ssl).toMatchObject({ rejectUnauthorized: false });
	});
	it('allows opting in to multipleStatements and overrides', () => {
		const o = buildConnectionOptions(base, 'u', 'p', {
			multipleStatements: true,
			extra: { connectTimeout: 5 }
		});
		expect(o.multipleStatements).toBe(true);
		expect(o.connectTimeout).toBe(5);
	});
});

describe('applyConnectionCollation', () => {
	it('runs SET collation_connection for valid names', async () => {
		const query = vi.fn().mockResolvedValue([]);
		expect(await applyConnectionCollation({ query } as never, 'utf8mb4_unicode_ci')).toBe(true);
		expect(query).toHaveBeenCalledWith('SET collation_connection = ?', ['utf8mb4_unicode_ci']);
	});

	it('does nothing for empty or malformed names', async () => {
		const query = vi.fn();
		expect(await applyConnectionCollation({ query } as never, undefined)).toBe(false);
		expect(await applyConnectionCollation({ query } as never, "x'; DROP")).toBe(false);
		expect(query).not.toHaveBeenCalled();
		expect(isValidCollationName('utf8mb4_0900_ai_ci')).toBe(true);
	});

	it('swallows server errors (unknown collation)', async () => {
		const query = vi.fn().mockRejectedValue(new Error('Unknown collation'));
		expect(await applyConnectionCollation({ query } as never, 'nope')).toBe(false);
	});
});
