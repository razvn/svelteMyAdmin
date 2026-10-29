import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import { newColumn } from '#lib/sql/column-definition.ts';
import { findPartialDependencies, loadTableInfo, runOperation } from './normalization';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`normalization against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const db = `tmp_t9c_int_${port}`;
		const q = async (sql: string) => {
			await conn!.query(sql);
		};
		const rows = async (sql: string) => (await conn!.query(sql))[0] as Record<string, unknown>[];

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
				await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
				await conn.query(`CREATE DATABASE \`${db}\``);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn?.end();
		});

		it('adds a primary key column and a primary key on existing columns', async (c) => {
			if (!conn) return c.skip();
			await q(`CREATE TABLE \`${db}\`.nopk (a int, b varchar(10))`);
			await q(`INSERT INTO \`${db}\`.nopk VALUES (1,'x'),(2,'y')`);
			const r = await runOperation(dbi, db, 'nopk', {
				op: 'addColumns',
				payload: {
					columns: [newColumn({ name: 'nopk_id', autoIncrement: true, index: 'PRIMARY' })],
					placement: { where: 'first' }
				}
			});
			expect(r.ok).toBe(true);
			expect((await loadTableInfo(dbi, db, 'nopk'))?.pk).toEqual(['nopk_id']);

			await q(`CREATE TABLE \`${db}\`.nopk2 (a int NOT NULL, b int NOT NULL)`);
			const r2 = await runOperation(dbi, db, 'nopk2', { op: 'addPrimary', columns: ['a', 'b'] });
			expect(r2.ok).toBe(true);
			expect((await loadTableInfo(dbi, db, 'nopk2'))?.pk).toEqual(['a', 'b']);
		});

		it('moves a repeating group to a new table', async (c) => {
			if (!conn) return c.skip();
			await q(
				`CREATE TABLE \`${db}\`.books (id int PRIMARY KEY, title varchar(20), author1 varchar(20), author2 varchar(20))`
			);
			await q(`INSERT INTO \`${db}\`.books VALUES (1,'T','ann','bob'),(2,'U','cy','dee')`);
			const r = await runOperation(dbi, db, 'books', {
				op: 'repeating',
				columns: ['author1', 'author2'],
				newTable: 'book_authors',
				newColumn: 'author'
			});
			expect(r.ok).toBe(true);
			const authors = await rows(
				`SELECT id, author FROM \`${db}\`.book_authors ORDER BY id, author`
			);
			expect(authors).toHaveLength(4);
			expect((await loadTableInfo(dbi, db, 'books'))?.columns.map((x) => x.name)).toEqual([
				'id',
				'title'
			]);
		});

		it('finds partial dependencies and decomposes to 2NF', async (c) => {
			if (!conn) return c.skip();
			await q(
				`CREATE TABLE \`${db}\`.orders (order_id int, product_id int, qty int, product_name varchar(20), PRIMARY KEY (order_id, product_id))`
			);
			await q(
				`INSERT INTO \`${db}\`.orders VALUES (1,1,5,'pen'),(1,2,1,'ink'),(2,1,2,'pen'),(2,3,7,'cap'),(3,2,4,'ink')`
			);
			const deps = await findPartialDependencies(dbi, db, 'orders');
			expect(deps['product_id']).toContain('product_name');
			const r = await runOperation(dbi, db, 'orders', {
				op: 'decompose',
				table: 'orders',
				answers: [
					{ column: 'qty', dependsOn: [] },
					{ column: 'product_name', dependsOn: ['product_id'] }
				],
				names: { product_id: 'products' }
			});
			expect(r.ok).toBe(true);
			expect(await rows(`SELECT * FROM \`${db}\`.products ORDER BY product_id`)).toHaveLength(3);
			expect((await loadTableInfo(dbi, db, 'orders'))?.columns.map((x) => x.name)).toEqual([
				'order_id',
				'product_id',
				'qty'
			]);
			expect((await loadTableInfo(dbi, db, 'products'))?.pk).toEqual(['product_id']);
		});

		it('decomposes a transitive dependency (3NF)', async (c) => {
			if (!conn) return c.skip();
			await q(
				`CREATE TABLE \`${db}\`.emp (id int PRIMARY KEY, dept_id int, dept_name varchar(20), name varchar(20))`
			);
			await q(
				`INSERT INTO \`${db}\`.emp VALUES (1,10,'ops','a'),(2,10,'ops','b'),(3,20,'dev','c')`
			);
			const r = await runOperation(dbi, db, 'emp', {
				op: 'decompose',
				table: 'emp',
				answers: [{ column: 'dept_name', dependsOn: ['dept_id'] }],
				names: { dept_id: 'dept' }
			});
			expect(r.ok).toBe(true);
			expect(await rows(`SELECT * FROM \`${db}\`.dept`)).toHaveLength(2);
			expect((await loadTableInfo(dbi, db, 'emp'))?.columns.map((x) => x.name)).toEqual([
				'id',
				'dept_id',
				'name'
			]);
		});

		it('rejects an existing table name', async (c) => {
			if (!conn) return c.skip();
			await q(`CREATE TABLE \`${db}\`.k (a int, b int, c int, PRIMARY KEY (a,b))`);
			const r = await runOperation(dbi, db, 'k', {
				op: 'decompose',
				table: 'k',
				answers: [{ column: 'c', dependsOn: ['a'] }],
				names: { a: 'emp' }
			});
			expect(r.ok).toBe(false);
		});
	});
}
