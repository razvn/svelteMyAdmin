import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyConnectionCollation, createConnection, type Connection } from './connection';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`connection against ${name}`, () => {
		let conn: Connection | undefined;

		beforeAll(async () => {
			try {
				conn = await createConnection(
					{
						host: '127.0.0.1',
						port,
						socket: '',
						ssl: false,
						ssl_ca: null,
						ssl_cert: null,
						ssl_key: null,
						ssl_ciphers: null,
						ssl_verify: true,
						compress: false
					},
					'root',
					'root'
				);
			} catch {
				console.warn(
					`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping (run pnpm db:up)`
				);
			}
		});
		afterAll(async () => {
			await conn?.end();
		});

		it('reports its version', async (ctx) => {
			if (!conn) return ctx.skip();
			const [rows] = await conn.query('SELECT VERSION() AS v');
			const v = (rows as { v: string }[])[0].v;
			expect(v).toMatch(/^\d+\.\d+/);
			expect(name.startsWith('mariadb') ? /mariadb/i.test(v) : !/mariadb/i.test(v)).toBe(true);
		});

		it('has the sma_test fixture tables', async (ctx) => {
			if (!conn) return ctx.skip();
			const [rows] = await conn.query(
				'SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
				['sma_test']
			);
			const names = (rows as { n: string }[]).map((r) => r.n);
			expect(names).toEqual(
				expect.arrayContaining(['authors', 'books', 'type_zoo', 'v_book_authors'])
			);
		});

		it('returns binary as Buffer, bigint/decimal/date as strings', async (ctx) => {
			if (!conn) return ctx.skip();
			const [rows] = await conn.query(
				'SELECT c_bigint, c_decimal, c_date, c_datetime, c_blob, c_json FROM sma_test.type_zoo WHERE id = 1'
			);
			const r = (rows as Record<string, unknown>[])[0];
			expect(typeof r.c_bigint).toBe('string');
			expect(typeof r.c_decimal).toBe('string');
			expect(r.c_date).toBe('2024-02-29');
			expect(typeof r.c_datetime).toBe('string');
			expect(Buffer.isBuffer(r.c_blob)).toBe(true);
			expect(typeof r.c_json).toBe('string');
		});

		it('rejects multiple statements by default', async (ctx) => {
			if (!conn) return ctx.skip();
			await expect(conn.query('SELECT 1; SELECT 2')).rejects.toThrow();
		});

		it('applies the connection collation and ignores unknown ones', async (ctx) => {
			if (!conn) return ctx.skip();
			const get = async () => {
				const [rows] = await conn!.query('SELECT @@collation_connection AS c');
				return (rows as { c: string }[])[0].c;
			};
			expect(await applyConnectionCollation(conn, 'utf8mb4_general_ci')).toBe(true);
			expect(await get()).toBe('utf8mb4_general_ci');
			expect(await applyConnectionCollation(conn, 'no_such_collation')).toBe(false);
			expect(await get()).toBe('utf8mb4_general_ci');
			expect(await applyConnectionCollation(conn, 'bad name; DROP')).toBe(false);
		});
	});
}
