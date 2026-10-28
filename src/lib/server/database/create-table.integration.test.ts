import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import { getVirtualities, newColumn, type ColumnDef } from '#lib/sql/column-definition.ts';
import { createTable, getCreateTableContext } from './create-table';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

const def = (o: Partial<ColumnDef>) => newColumn(o);

for (const { name, port } of servers) {
	describe(`create table against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const db = `sma_t3b_int_${port}`;

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

		it('lists engines and collations', async (ctx) => {
			if (!conn) return ctx.skip();
			const c = await getCreateTableContext(dbi);
			expect(c.defaultEngine).toBe('InnoDB');
			expect(c.engines.map((e) => e.name)).toContain('InnoDB');
			expect(c.collations.length).toBeGreaterThan(50);
		});

		it('creates a table with many column types, keys and options', async (ctx) => {
			if (!conn) return ctx.skip();
			const info = await getCreateTableContext(dbi);
			const res = await createTable(dbi, db, {
				name: 'many',
				comment: "it's a test",
				collation: 'utf8mb4_bin',
				engine: 'InnoDB',
				columns: [
					def({
						name: 'id',
						type: 'BIGINT',
						attribute: 'UNSIGNED',
						autoIncrement: true,
						index: 'PRIMARY'
					}),
					def({
						name: 'tiny',
						type: 'TINYINT',
						length: '1',
						defaultType: 'USER_DEFINED',
						defaultValue: '1'
					}),
					def({ name: 'price', type: 'DECIMAL', length: '10,2', null: true, defaultType: 'NULL' }),
					def({ name: 'ratio', type: 'DOUBLE' }),
					def({ name: 'flag', type: 'BOOLEAN', defaultType: 'USER_DEFINED', defaultValue: 'true' }),
					def({
						name: 'bits',
						type: 'BIT',
						length: '4',
						defaultType: 'USER_DEFINED',
						defaultValue: '101'
					}),
					def({
						name: 'email',
						type: 'VARCHAR',
						length: '190',
						collation: 'utf8mb4_general_ci',
						index: 'UNIQUE',
						comment: 'unique mail'
					}),
					def({ name: 'bio', type: 'TEXT', null: true, index: 'FULLTEXT' }),
					def({
						name: 'kind',
						type: 'ENUM',
						length: "'a','b''c','d'",
						defaultType: 'USER_DEFINED',
						defaultValue: "b'c"
					}),
					def({ name: 'tags', type: 'SET', length: "'x','y','z'", null: true }),
					def({ name: 'born', type: 'DATE', null: true, index: 'INDEX' }),
					def({
						name: 'created',
						type: 'TIMESTAMP',
						length: '3',
						defaultType: 'CURRENT_TIMESTAMP',
						attribute: 'on update CURRENT_TIMESTAMP'
					}),
					def({ name: 'seen', type: 'DATETIME', length: '6', null: true, defaultType: 'NULL' }),
					def({ name: 'blob_col', type: 'LONGBLOB', null: true }),
					def({
						name: 'bin',
						type: 'BINARY',
						length: '4',
						defaultType: 'USER_DEFINED',
						defaultValue: 'deadbeef'
					}),
					def({ name: 'doc', type: 'JSON', null: true }),
					def({ name: 'pt', type: 'POINT' }),
					def({ name: 'geo', type: 'GEOMETRY', null: true }),
					def({
						name: 'price_x2',
						type: 'DECIMAL',
						length: '12,2',
						virtuality: 'VIRTUAL',
						expression: '`price` * 2'
					}),
					def({
						name: 'email_len',
						type: 'INT',
						virtuality: getVirtualities(info.caps)[1],
						expression: 'char_length(`email`)'
					}),
					def({ name: '', type: 'INT' })
				]
			});
			expect(res, JSON.stringify(res)).toMatchObject({ ok: true, table: 'many' });

			const [cols] = await conn.query(
				'SELECT COLUMN_NAME n, COLUMN_TYPE t, EXTRA e, IS_NULLABLE nl, COLUMN_DEFAULT d, COLUMN_KEY k, COLUMN_COMMENT c ' +
					'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
				[db, 'many']
			);
			const byName = Object.fromEntries((cols as Record<string, string>[]).map((r) => [r.n, r]));
			expect(Object.keys(byName)).toHaveLength(20);
			// MariaDB reports the display width (bigint(20)), MySQL 8 does not
			expect(byName.id.t.replace('(20)', '')).toBe('bigint unsigned');
			expect(byName.id.e).toContain('auto_increment');
			expect(byName.id.k).toBe('PRI');
			expect(byName.tiny.t).toBe('tinyint(1)');
			expect(byName.price.t).toBe('decimal(10,2)');
			expect(byName.price.nl).toBe('YES');
			expect(byName.bits.t).toBe('bit(4)');
			expect(byName.email.k).toBe('UNI');
			expect(byName.email.c).toBe('unique mail');
			expect(byName.kind.t).toBe("enum('a','b''c','d')");
			expect(byName.tags.t).toBe("set('x','y','z')");
			expect(byName.created.t).toBe('timestamp(3)');
			expect(byName.created.e.toLowerCase()).toContain('on update current_timestamp(3)');
			expect(byName.doc.t.toLowerCase()).toMatch(/^(json|longtext)$/);
			expect(byName.pt.t).toBe('point');
			expect(byName.price_x2.e.toUpperCase()).toMatch(/VIRTUAL/);
			expect(byName.email_len.e.toUpperCase()).toMatch(/STORED|PERSISTENT/);

			const [t] = await conn.query(
				'SELECT ENGINE e, TABLE_COLLATION c, TABLE_COMMENT m FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
				[db, 'many']
			);
			expect((t as Record<string, string>[])[0]).toEqual({
				e: 'InnoDB',
				c: 'utf8mb4_bin',
				m: "it's a test"
			});
		});

		it('creates MariaDB-only UUID / INET6 columns', async (ctx) => {
			if (!conn) return ctx.skip();
			const info = await getCreateTableContext(dbi);
			if (info.caps.serverType !== 'MariaDB') return ctx.skip();
			const res = await createTable(dbi, db, {
				name: 'maria_types',
				columns: [
					def({ name: 'u', type: 'UUID', defaultType: 'UUID' }),
					def({ name: 'ip', type: 'INET6', null: true })
				]
			});
			expect(res.ok).toBe(true);
		});

		it('auto_increment without an explicit key gets a primary key', async (ctx) => {
			if (!conn) return ctx.skip();
			const res = await createTable(dbi, db, {
				name: 'autoinc',
				columns: [def({ name: 'id', type: 'INT', autoIncrement: true })]
			});
			expect(res.ok).toBe(true);
		});

		it('reports server errors and duplicates without creating anything', async (ctx) => {
			if (!conn) return ctx.skip();
			const bad = await createTable(dbi, db, {
				name: 'broken',
				columns: [def({ name: 'a', type: 'VARCHAR' })]
			});
			expect(bad.ok).toBe(false);
			const dup = await createTable(dbi, db, {
				name: 'many',
				columns: [def({ name: 'a', type: 'INT' })]
			});
			expect(dup).toEqual({ ok: false, error: 'Table many already exists!' });
			expect(await dbi.getTableType(db, 'broken')).toBeNull();
		});

		it('validates input before touching the server', async (ctx) => {
			if (!conn) return ctx.skip();
			expect(await createTable(dbi, db, { name: '', columns: [] })).toMatchObject({ ok: false });
			expect(
				await createTable(dbi, db, { name: 'x', columns: [def({ name: 'a', type: 'EVIL); --' })] })
			).toMatchObject({ ok: false });
			expect(await createTable(dbi, db, { name: 'x', columns: [def({ name: '' })] })).toEqual({
				ok: false,
				error: 'The table needs at least one named column.'
			});
			expect(
				await createTable(dbi, db, {
					name: 'x',
					engine: 'Nope',
					columns: [def({ name: 'a' })]
				})
			).toMatchObject({ ok: false });
		});
	});
}
