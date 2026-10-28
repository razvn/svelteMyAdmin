import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import {
	createDatabase,
	dropDatabases,
	getServerCollation,
	getServerPrivileges,
	listDatabasesFull
} from './databases';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`admin/databases against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const db = `sma_t2a_int_${port}`;

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
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn?.end();
		});

		it('root has the create/super privileges', async ({ skip }) => {
			if (!conn) return skip();
			expect(await getServerPrivileges(dbi)).toEqual({ isSuperUser: true, canCreateDb: true });
			expect(await getServerCollation(dbi)).toMatch(/_ci$|_bin$/);
		});

		it('creates, lists with statistics, and drops', async ({ skip }) => {
			if (!conn) return skip();
			const created = await createDatabase(dbi, { new_db: db, db_collation: 'latin1_swedish_ci' });
			expect(created).toEqual({ ok: true, name: db });
			expect((await createDatabase(dbi, { new_db: db })).ok).toBe(false);
			expect((await createDatabase(dbi, { new_db: '' })).ok).toBe(false);

			await conn.query(
				`CREATE TABLE \`${db}\`.t (id INT PRIMARY KEY, v VARCHAR(10), KEY(v)) ENGINE=InnoDB`
			);
			await conn.query(`INSERT INTO \`${db}\`.t VALUES (1,'a'),(2,'b')`);

			const plain = await listDatabasesFull(dbi, {
				statistics: false,
				sortBy: 'SCHEMA_NAME',
				sortOrder: 'asc'
			});
			const mine = plain.find((d) => d.name === db)!;
			expect(mine.collation).toBe('latin1_swedish_ci');
			expect(mine.stats).toBeNull();
			expect(plain.find((d) => d.name === 'information_schema')!.isSystemSchema).toBe(true);

			const full = await listDatabasesFull(dbi, {
				statistics: true,
				sortBy: 'SCHEMA_LENGTH',
				sortOrder: 'desc'
			});
			const s = full.find((d) => d.name === db)!.stats!;
			expect(s.SCHEMA_TABLES).toBe(1);
			expect(s.SCHEMA_DATA_LENGTH).toBeGreaterThan(0);
			expect(s.SCHEMA_LENGTH).toBe(s.SCHEMA_DATA_LENGTH + s.SCHEMA_INDEX_LENGTH);
			expect(s.SCHEMA_DATA_FREE).toBe(0); // InnoDB free space is not overhead

			const res = await dropDatabases(dbi, [db, 'mysql', 'information_schema']);
			expect(res).toEqual({ ok: true, dropped: [db], skipped: ['mysql', 'information_schema'] });
			expect(await dbi.databaseExists(db)).toBe(false);
		});

		it('refuses system schemas only and quotes odd names', async ({ skip }) => {
			if (!conn) return skip();
			expect((await dropDatabases(dbi, ['mysql'])).ok).toBe(false);
			expect((await dropDatabases(dbi, [])).ok).toBe(false);
			const odd = `sma_t2a_odd\`x_${port}`;
			expect((await createDatabase(dbi, { new_db: odd })).ok).toBe(true);
			expect(await dbi.databaseExists(odd)).toBe(true);
			expect((await dropDatabases(dbi, [odd])).ok).toBe(true);
		});
	});
}
