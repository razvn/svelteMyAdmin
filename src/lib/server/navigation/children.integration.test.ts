import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import { getDbChildren } from './children';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`navigation children against ${name}`, () => {
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

		it('splits tables, views, procedures, functions and events', async ({ skip }) => {
			if (!conn) return skip();
			const c = await getDbChildren(dbi, 'sma_test');
			expect(c.db).toBe('sma_test');
			expect(c.tables).toEqual(expect.arrayContaining(['authors', 'books']));
			expect(c.tables).not.toContain('v_book_authors');
			expect(c.views).toContain('v_book_authors');
			expect(c.procedures).toContain('sp_books_by_author');
			expect(c.functions).toContain('fn_book_count');
			expect(Array.isArray(c.events)).toBe(true);
		});

		it('honours the NavigationTreeShow* switches', async ({ skip }) => {
			if (!conn) return skip();
			const c = await getDbChildren(dbi, 'sma_test', {
				showTables: false,
				showViews: true,
				showFunctions: false,
				showProcedures: true,
				showEvents: false
			});
			expect(c.tables).toEqual([]);
			expect(c.views).toContain('v_book_authors');
			expect(c.functions).toEqual([]);
			expect(c.procedures).toContain('sp_books_by_author');
			expect(c.events).toEqual([]);
		});
	});
}
