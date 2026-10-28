import { describe, expect, it } from 'vitest';
import { buildConnectionOptions } from './connection';

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
