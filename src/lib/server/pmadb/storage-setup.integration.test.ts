import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection.ts';
import { escapeId, escapeQualified } from '../db/escape.ts';
import { addTable, removeTable, type TableRef } from '#lib/nav/recent.ts';
import {
	createMissingTables,
	createPmaDatabase,
	featureStatuses,
	listPmadbTables,
	PMA_FEATURES
} from './features.ts';
import { deleteHiddenRow, insertHiddenRow, selectHiddenRows } from './navigation-hiding.ts';
import { replaceTablesRow, selectTablesRow } from './recent-favorite.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

// Only the default table names matter here: every feature maps to its pma__* table.
const names = Object.fromEntries(PMA_FEATURES.map((f) => [f.key, f.table]));

for (const { name, port } of servers) {
	describe(`configuration storage setup against ${name}`, () => {
		let conn: Connection | undefined;
		const pmadb = 'tmp_t8a_pma';

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
				await conn.query(`DROP DATABASE IF EXISTS ${escapeId(pmadb)}`);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.query(`DROP DATABASE IF EXISTS ${escapeId(pmadb)}`);
			await conn?.end();
		});

		it('creates the database and all 19 tables, then reports all OK; idempotent', async (ctx) => {
			if (!conn) return ctx.skip();
			expect(await listPmadbTables(conn, pmadb)).toBeNull();
			await createPmaDatabase(conn, pmadb);
			expect((await listPmadbTables(conn, pmadb))?.size).toBe(0);

			const created = await createMissingTables(conn, pmadb, names);
			expect(created).toHaveLength(19);
			const tables = await listPmadbTables(conn, pmadb);
			expect([...(tables ?? [])].sort()).toEqual(PMA_FEATURES.map((f) => f.table).sort());

			const status = featureStatuses({ pmadb, ...names }, tables);
			expect(status.allWorks).toBe(true);
			expect(await createMissingTables(conn, pmadb, names)).toEqual([]);
			// the connection's default database was not changed by the setup
			const [[row]] = (await conn.query('SELECT DATABASE() AS db')) as unknown as [
				{ db: string | null }[]
			];
			expect(row.db).not.toBe(pmadb);
		});

		it('creates only the missing tables', async (ctx) => {
			if (!conn) return ctx.skip();
			await conn.query(`DROP TABLE ${escapeQualified(pmadb, 'pma__favorite')}`);
			await conn.query(`DROP TABLE ${escapeQualified(pmadb, 'pma__tracking')}`);
			const status = featureStatuses({ pmadb, ...names }, await listPmadbTables(conn, pmadb));
			expect(status.features.filter((f) => !f.ok).map((f) => f.key)).toEqual([
				'favorite',
				'tracking'
			]);
			expect((await createMissingTables(conn, pmadb, names)).sort()).toEqual([
				'pma__favorite',
				'pma__tracking'
			]);
		});

		it('keeps recent and favorite lists as phpMyAdmin JSON and round-trips them', async (ctx) => {
			if (!conn) return ctx.skip();
			const recent = escapeQualified(pmadb, 'pma__recent');
			expect(await selectTablesRow(conn, recent, 'alice')).toEqual([]);
			let list: TableRef[] = [];
			list = addTable(list, { db: 'sma_test', table: 'authors' }, 10);
			list = addTable(list, { db: 'sma_test', table: 'books' }, 10);
			await replaceTablesRow(conn, recent, 'alice', list);
			await replaceTablesRow(conn, recent, 'alice', list); // REPLACE: still one row
			const [raw] = await conn.query(`SELECT * FROM ${recent}`);
			expect(raw).toEqual([
				{
					username: 'alice',
					tables: '[{"db":"sma_test","table":"books"},{"db":"sma_test","table":"authors"}]'
				}
			]);
			expect(await selectTablesRow(conn, recent, 'alice')).toEqual(list);
			// a row written by PHP (escaped slashes) is read back
			await conn.query(`REPLACE INTO ${recent} VALUES ('bob', ?)`, [
				'[{"db":"a","table":"b\\/c"}]'
			]);
			expect(await selectTablesRow(conn, recent, 'bob')).toEqual([{ db: 'a', table: 'b/c' }]);
			// removal
			await replaceTablesRow(conn, recent, 'alice', removeTable(list, list[0]));
			expect(await selectTablesRow(conn, recent, 'alice')).toEqual([
				{ db: 'sma_test', table: 'authors' }
			]);
		});

		it('hides and unhides navigation items per user and database', async (ctx) => {
			if (!conn) return ctx.skip();
			const nav = escapeQualified(pmadb, 'pma__navigationhiding');
			await insertHiddenRow(conn, nav, 'alice', 'sma_test', { name: 'books', type: 'table' });
			await insertHiddenRow(conn, nav, 'alice', 'sma_test', { name: 'books', type: 'table' });
			await insertHiddenRow(conn, nav, 'alice', 'sma_test', { name: 'sp_x', type: 'procedure' });
			await insertHiddenRow(conn, nav, 'bob', 'sma_test', { name: 'authors', type: 'table' });
			expect(await selectHiddenRows(conn, nav, 'alice', 'sma_test')).toEqual([
				{ name: 'sp_x', type: 'procedure' },
				{ name: 'books', type: 'table' }
			]);
			expect(await selectHiddenRows(conn, nav, 'alice', 'other')).toEqual([]);
			await deleteHiddenRow(conn, nav, 'alice', 'sma_test', { name: 'books', type: 'table' });
			expect(await selectHiddenRows(conn, nav, 'alice', 'sma_test')).toEqual([
				{ name: 'sp_x', type: 'procedure' }
			]);
			expect(await selectHiddenRows(conn, nav, 'bob', 'sma_test')).toHaveLength(1);
		});
	});
}
