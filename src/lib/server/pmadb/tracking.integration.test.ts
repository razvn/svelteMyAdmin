import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverSchema } from '../config/schema.ts';
import { createConnection, type Connection } from '../db/connection.ts';
import { escapeQualified } from '../db/escape.ts';
import { DatabaseInterface } from '../db/dbi.ts';
import {
	addCentral,
	addTableColumns,
	countCentral,
	deleteCentral,
	listCentral,
	updateCentral
} from './central-columns.ts';
import {
	createVersion,
	deleteTracking,
	getTrackedData,
	getVersion,
	listTrackedTables,
	listVersions,
	saveLog,
	setActive,
	type TrackingCtx
} from './tracking.ts';
import { installTracking } from './tracking-hook.ts';
import { entriesToSql } from '../../tracking/analyse.ts';
import { reportEntries } from '../../tracking/report.ts';
import type { CentralColumn } from '../../sql/central-columns.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`tracking and central columns against ${name}`, () => {
		let conn: Connection | undefined;
		const db = `tmp_t8d_int_${port}`;
		const tracking = escapeQualified('phpmyadmin', 'pma__tracking');
		const central = escapeQualified('phpmyadmin', 'pma__central_columns');
		const server = serverSchema.parse({
			pmadb: 'phpmyadmin',
			tracking: 'pma__tracking',
			central_columns: 'pma__central_columns'
		});

		const cleanup = async () => {
			if (!conn) return;
			await conn.query(`DELETE FROM ${tracking} WHERE db_name = ?`, [db]);
			await conn.query(`DELETE FROM ${central} WHERE db_name = ?`, [db]);
			await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
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
				await conn.query(`SELECT 1 FROM ${tracking} LIMIT 1`);
				await conn.query(`SELECT 1 FROM ${central} LIMIT 1`);
				await cleanup();
				await conn.query(`CREATE DATABASE \`${db}\``);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} or its pmadb unreachable, skipping`);
			}
		});
		afterAll(async () => {
			await cleanup();
			await conn?.end();
		});

		const ctx = (c: Connection): TrackingCtx => ({
			conn: c,
			q: tracking,
			user: 'tester',
			server
		});

		it('central columns: CRUD with the phpMyAdmin encoding', async (t) => {
			if (!conn) return t.skip();
			await conn.query(
				`CREATE TABLE \`${db}\`.src (id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL DEFAULT 'x', note TEXT NULL)`
			);
			const dbi = new DatabaseInterface(conn, server);
			const res = await addTableColumns(conn, central, dbi, db, 'src', ['id', 'name', 'note']);
			expect(res.added).toEqual(['id', 'name', 'note']);
			const again = await addTableColumns(conn, central, dbi, db, 'src', ['id']);
			expect(again).toEqual({ added: [], existing: ['id'] });

			const [raw] = await conn.query(
				`SELECT * FROM ${central} WHERE db_name = ? AND col_name = 'id'`,
				[db]
			);
			expect((raw as Record<string, unknown>[])[0]).toMatchObject({
				col_type: 'int',
				col_length: expect.stringMatching(/^(10)?$/),
				col_isNull: 0,
				col_extra: 'auto_increment,UNSIGNED',
				col_default: ''
			});

			const list = await listCentral(conn, central, db);
			expect(list.map((c) => c.name)).toEqual(['id', 'name', 'note']);
			expect(list[1]).toMatchObject({ type: 'varchar', length: '20', default: 'x', isNull: false });
			expect(list[2].isNull).toBe(true);
			expect(await countCentral(conn, central, db)).toBe(3);
			expect(await countCentral(conn, central, db, 'no')).toBe(1);
			expect(await listCentral(conn, central, db, { pos: 1, num: 1 })).toHaveLength(1);

			const edited: CentralColumn = { ...list[1], name: 'title', length: '40' };
			await updateCentral(conn, central, db, 'name', edited);
			expect((await listCentral(conn, central, db, { filter: 'titl' }))[0]).toMatchObject({
				name: 'title',
				length: '40'
			});
			await addCentral(conn, central, db, [
				{ ...edited, name: 'extra_col', extra: '', attribute: '' }
			]);
			expect(await deleteCentral(conn, central, db, ['title', 'extra_col', 'ghost'])).toEqual([
				'ghost'
			]);
			expect(await countCentral(conn, central, db)).toBe(2);
		});

		it('tracks DDL and DML run through the connection, stops when deactivated', async (t) => {
			if (!conn) return t.skip();
			// The test connection doubles as storage connection (no control user), like the app does.
			const hook = installTracking(conn, server, 'tester');
			expect(hook).not.toBeNull();
			try {
				await conn.query(`CREATE TABLE \`${db}\`.tr (id INT PRIMARY KEY, v VARCHAR(10))`);
				const c = ctx(conn);
				await createVersion(c, conn, { db, table: 'tr', version: 1 });
				expect(await getVersion(c, db, 'tr')).toBe(1);

				await conn.query(`USE \`${db}\``);
				await conn.query('ALTER TABLE `tr` ADD COLUMN extra INT');
				await conn.query('INSERT INTO tr (id, v) VALUES (?, ?)', [1, "it's"]);
				await conn.execute('UPDATE tr SET v = ? WHERE id = ?', ['two', 1]);
				await conn.query(`SELECT * FROM \`${db}\`.tr`);
				await conn.query(`DELETE FROM \`${db}\`.tr WHERE id = 1`);
				// statements on another table are not recorded
				await conn.query('CREATE TABLE other (a INT)');
				await conn.query('INSERT INTO other VALUES (1)');
				// NOTRACK is honoured
				await conn.query('/*NOTRACK*/ INSERT INTO tr (id) VALUES (50)');

				const data = await getTrackedData(c, db, 'tr', 1);
				expect(data).not.toBeNull();
				expect(data!.ddlog.map((e) => e.statement)).toEqual([
					'DROP TABLE IF EXISTS `tr`;',
					expect.stringContaining('CREATE TABLE `tr`'),
					'ALTER TABLE `tr` ADD COLUMN extra INT;'
				]);
				expect(data!.dmlog.map((e) => e.statement)).toEqual([
					"INSERT INTO tr (id, v) VALUES (1, 'it\\'s');",
					"UPDATE tr SET v = 'two' WHERE id = 1;",
					`DELETE FROM tr WHERE id = 1;`
				]);
				expect(data!.dmlog.every((e) => e.username === 'tester')).toBe(true);
				expect(data!.snapshot.COLUMNS.map((x) => x.Field)).toEqual(['id', 'v']);
				expect(data!.tracking).toContain('INSERT');

				// report filtering and the SQL dump
				const only = reportEntries(data!.ddlog, data!.dmlog, 'data', { users: 'tester' });
				expect(only).toHaveLength(3);
				expect(reportEntries(data!.ddlog, data!.dmlog, 'data', { users: 'nobody' })).toHaveLength(
					0
				);
				expect(entriesToSql(only)).toContain('UPDATE tr SET');

				// a deleted row disappears from the log
				await saveLog(c, db, 'tr', 1, 'dml', data!.dmlog.slice(1));
				expect((await getTrackedData(c, db, 'tr', 1))!.dmlog).toHaveLength(2);

				// deactivate: nothing more is recorded
				await setActive(c, db, 'tr', 1, false);
				await conn.query('INSERT INTO tr (id) VALUES (2)');
				expect((await getTrackedData(c, db, 'tr', 1))!.dmlog).toHaveLength(2);
				await setActive(c, db, 'tr', 1, true);
				await conn.query('INSERT INTO tr (id) VALUES (3)');
				expect((await getTrackedData(c, db, 'tr', 1))!.dmlog).toHaveLength(3);

				// rename keeps the tracking row attached to the new name
				await conn.query('RENAME TABLE tr TO tr2');
				expect((await listTrackedTables(c, db)).map((v) => v.table)).toEqual(['tr2']);

				// a second version deactivates the first
				await createVersion(c, conn, { db, table: 'tr2', version: 2, trackingSet: 'INSERT' });
				const versions = await listVersions(c, db, 'tr2');
				expect(versions.map((v) => [v.version, v.active])).toEqual([
					[2, true],
					[1, false]
				]);
				expect(versions[0].tracking).toBe('INSERT');

				await deleteTracking(c, db, 'tr2', 2);
				expect(await getVersion(c, db, 'tr2')).toBe(1);
				await deleteTracking(c, db, 'tr2');
				expect(await getVersion(c, db, 'tr2')).toBe(-1);
			} finally {
				await hook?.close();
			}
		});

		it('creates version 1 on CREATE TABLE when tracking_version_auto_create is on', async (t) => {
			if (!conn) return t.skip();
			const auto = serverSchema.parse({
				pmadb: 'phpmyadmin',
				tracking: 'pma__tracking',
				tracking_version_auto_create: true
			});
			const hook = installTracking(conn, auto, 'tester');
			try {
				await conn.query(`USE \`${db}\``);
				await conn.query('CREATE TABLE auto_t (id INT)');
				const c = { ...ctx(conn), server: auto };
				expect(await getVersion(c, db, 'auto_t')).toBe(1);
				await conn.query('INSERT INTO auto_t VALUES (1)');
				const data = await getTrackedData(c, db, 'auto_t', 1);
				expect(data!.dmlog).toHaveLength(1);
				expect(data!.ddlog[1].statement).toContain('CREATE TABLE `auto_t`');
			} finally {
				await hook?.close();
			}
		});
	});
}
