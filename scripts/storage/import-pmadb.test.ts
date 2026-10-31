import { describe, expect, it } from 'vitest';
import { storageServerId } from '../../src/lib/server/storage/index.ts';
import { serverId, TABLES, toSqliteValue } from './import-pmadb.ts';

describe('storage:import-pmadb helpers', () => {
	it('uses the same server id as the app', () => {
		for (const s of [
			{ host: '127.0.0.1', port: 33306, socket: '' },
			{ host: 'localhost', port: 0, socket: '' },
			{ host: 'x', port: '3307', socket: '' },
			{ host: 'x', port: 1, socket: '/tmp/m.sock' }
		]) {
			expect(serverId(s)).toBe(storageServerId({ ...s, port: Number(s.port) }));
		}
	});

	it('converts mysql2 values to SQLite values', () => {
		expect(toSqliteValue(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05');
		expect(toSqliteValue(null)).toBeNull();
		expect(toSqliteValue(true)).toBe(1);
		expect(toSqliteValue(7)).toBe(7);
		expect(toSqliteValue(Buffer.from('é'))).toBe('é');
		expect(toSqliteValue('a')).toBe('a');
	});

	it('knows the 19 tables', () => {
		expect(new Set(TABLES.map((t) => t[1])).size).toBe(19);
	});
});
