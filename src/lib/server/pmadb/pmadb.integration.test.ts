import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection.ts';
import { escapeQualified } from '../db/escape.ts';
import {
	deleteBookmarkRow,
	getBookmarkRow,
	insertBookmarkRow,
	listBookmarkRows
} from './bookmarks.ts';
import {
	clearHistoryRows,
	insertHistoryRow,
	purgeHistoryRows,
	selectHistoryRows
} from './history.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`configuration storage against ${name}`, () => {
		let conn: Connection | undefined;
		const history = escapeQualified('phpmyadmin', 'pma__history');
		const bookmarks = escapeQualified('phpmyadmin', 'pma__bookmark');
		const alice = `tmp_t5c_int_${port}_alice`;
		const bob = `tmp_t5c_int_${port}_bob`;
		const dbName = `tmp_t5c_int_${port}`;

		const cleanup = async () => {
			if (!conn) return;
			await conn.query(`DELETE FROM ${history} WHERE username IN (?, ?)`, [alice, bob]);
			await conn.query(`DELETE FROM ${bookmarks} WHERE dbase = ?`, [dbName]);
		};

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
				await conn.query(`SELECT 1 FROM ${history} LIMIT 1`);
				await conn.query(`SELECT 1 FROM ${bookmarks} LIMIT 1`);
				await cleanup();
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} or its pmadb unreachable, skipping`);
			}
		});
		afterAll(async () => {
			await cleanup();
			await conn?.end();
		});

		it('writes, lists newest first and purges history to the maximum', async (ctx) => {
			if (!conn) return ctx.skip();
			for (let i = 1; i <= 6; i++) {
				await insertHistoryRow(conn, history, {
					username: alice,
					db: dbName,
					table: 't',
					sqlquery: `SELECT ${i}`
				});
			}
			await insertHistoryRow(conn, history, {
				username: bob,
				db: '',
				table: '',
				sqlquery: 'SELECT 99'
			});
			// All six rows share (almost) one second: the purge must still keep exactly `max`.
			expect(await purgeHistoryRows(conn, history, alice, 4)).toBe(2);
			const rows = await selectHistoryRows(conn, history, alice, 25);
			expect(rows.map((r) => r.sqlquery)).toEqual(['SELECT 6', 'SELECT 5', 'SELECT 4', 'SELECT 3']);
			expect(rows[0]).toMatchObject({ db: dbName, table: 't' });
			expect(rows[0].timevalue).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
			// purging is per user and idempotent
			expect(await purgeHistoryRows(conn, history, alice, 4)).toBe(0);
			expect(await selectHistoryRows(conn, history, bob, 25)).toHaveLength(1);
			await clearHistoryRows(conn, history, alice);
			expect(await selectHistoryRows(conn, history, alice, 25)).toHaveLength(0);
			expect(await selectHistoryRows(conn, history, bob, 25)).toHaveLength(1);
		});

		it('creates, lists, replaces and deletes bookmarks with own/shared visibility', async (ctx) => {
			if (!conn) return ctx.skip();
			const base = { db: dbName, replace: false };
			const own = await insertBookmarkRow(conn, bookmarks, alice, {
				...base,
				label: 'b-own',
				query: 'SELECT 1',
				shared: false
			});
			const shared = await insertBookmarkRow(conn, bookmarks, alice, {
				...base,
				label: 'a-shared',
				query: "SELECT '[VARIABLE1]'",
				shared: true
			});

			const forAlice = await listBookmarkRows(conn, bookmarks, alice, dbName);
			expect(forAlice.map((b) => [b.label, b.shared])).toEqual([
				['a-shared', true],
				['b-own', false]
			]);
			// Bob sees only the shared one, and nothing from another database.
			expect((await listBookmarkRows(conn, bookmarks, bob, dbName)).map((b) => b.label)).toEqual([
				'a-shared'
			]);
			expect(await listBookmarkRows(conn, bookmarks, alice, `${dbName}_other`)).toEqual([]);
			expect(await getBookmarkRow(conn, bookmarks, bob, dbName, own)).toBeNull();
			expect((await getBookmarkRow(conn, bookmarks, bob, dbName, shared))?.query).toContain(
				'[VARIABLE1]'
			);

			// replace: same label is deleted first
			await insertBookmarkRow(conn, bookmarks, alice, {
				...base,
				replace: true,
				label: 'b-own',
				query: 'SELECT 2',
				shared: false
			});
			const after = await listBookmarkRows(conn, bookmarks, alice, dbName);
			expect(after.filter((b) => b.label === 'b-own').map((b) => b.query)).toEqual(['SELECT 2']);

			// without replace a duplicate label is kept
			await insertBookmarkRow(conn, bookmarks, alice, {
				...base,
				label: 'b-own',
				query: 'SELECT 3',
				shared: false
			});
			expect(
				(await listBookmarkRows(conn, bookmarks, alice, dbName)).filter((b) => b.label === 'b-own')
			).toHaveLength(2);

			// bob cannot delete alice's private bookmark, but alice can
			expect(await deleteBookmarkRow(conn, bookmarks, bob, own)).toBe(false);
			const all = await listBookmarkRows(conn, bookmarks, alice, dbName);
			for (const b of all) expect(await deleteBookmarkRow(conn, bookmarks, alice, b.id)).toBe(true);
			expect(await listBookmarkRows(conn, bookmarks, alice, dbName)).toEqual([]);
		});
	});
}
