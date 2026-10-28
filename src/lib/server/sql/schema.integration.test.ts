import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import { getSchemaCompletion } from './schema';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`schema completion against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;

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
				dbi = new DatabaseInterface(conn, { only_db: '', hide_db: '', host: '127.0.0.1', port });
			} catch {
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.end();
		});

		it('returns tables, views and ordered columns of sma_test', async ({ skip }) => {
			if (!conn) return skip();
			const { tables } = await getSchemaCompletion(dbi, 'sma_test');
			expect(Object.keys(tables)).toEqual(
				expect.arrayContaining(['authors', 'books', 'type_zoo', 'v_book_authors'])
			);
			expect(tables.books[0]).toBe('id');
			expect(tables.books.length).toBeGreaterThan(2);
		});

		it('returns nothing for an unknown database', async ({ skip }) => {
			if (!conn) return skip();
			expect((await getSchemaCompletion(dbi, 'tmp_no_such_db_xyz')).tables).toEqual({});
		});
	});
}
