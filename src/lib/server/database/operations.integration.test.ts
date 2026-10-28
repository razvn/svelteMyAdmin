import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import { loadDataDictionary } from './data-dictionary';
import {
	adjustPrivileges,
	canAdjustPrivileges,
	changeCollation,
	copyDatabase,
	getDatabaseCollation,
	getDbComment,
	hasColumnInfo,
	renameDatabase,
	setDbComment,
	transferColumnInfo,
	type StorageServer
} from './operations';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`database/operations against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const src = `sma_t3c_src_${port}`;
		const copy = `sma_t3c_copy_${port}`;
		const renamed = `sma_t3c_ren_${port}`;
		const pma = `sma_t3c_pma_${port}`;
		const all = [src, copy, renamed, pma];
		const storage: StorageServer = {
			host: '127.0.0.1',
			port,
			socket: '',
			ssl: false,
			ssl_ca: null,
			ssl_cert: null,
			ssl_key: null,
			ssl_ciphers: null,
			ssl_verify: true,
			compress: false,
			controlhost: '',
			controlport: 0,
			controluser: '',
			controlpass: '',
			pmadb: pma,
			column_info: 'pma__column_info',
			relation: ''
		};

		const q = async (sql: string) =>
			((await conn!.query(sql))[0] as Record<string, unknown>[]).map((r) =>
				'n' in r ? { ...r, n: typeof r.n === 'string' && /^\d+$/.test(r.n) ? Number(r.n) : r.n } : r
			);
		const dropAll = async () => {
			for (const d of all) await conn!.query(`DROP DATABASE IF EXISTS \`${d}\``);
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
				dbi = new DatabaseInterface(conn, { only_db: '', hide_db: '', host: '127.0.0.1', port });
				await dropAll();
				await conn.query(
					`CREATE DATABASE \`${src}\` DEFAULT CHARACTER SET latin1 COLLATE latin1_swedish_ci`
				);
				await conn.query(`USE \`${src}\``);
				await conn.query(
					'CREATE TABLE parent (id INT PRIMARY KEY, label VARCHAR(20)) ENGINE=InnoDB'
				);
				await conn.query(
					'CREATE TABLE child (id INT AUTO_INCREMENT PRIMARY KEY, pid INT, note VARCHAR(20), ' +
						"dbl INT AS (pid * 2) VIRTUAL, COMMENT_COL INT NULL COMMENT 'hello', " +
						'CONSTRAINT fk_child FOREIGN KEY (pid) REFERENCES parent (id)) ENGINE=InnoDB'
				);
				await conn.query("INSERT INTO parent VALUES (1,'one'),(2,'two')");
				await conn.query("INSERT INTO child (pid, note) VALUES (1,'a'),(2,'b'),(2,'c')");
				await conn.query(
					"CREATE TRIGGER trg_child BEFORE INSERT ON child FOR EACH ROW SET NEW.note = CONCAT('t-', NEW.note)"
				);
				// created in the "wrong" alphabetical order on purpose: v_top depends on v_base
				await conn.query('CREATE VIEW v_base AS SELECT id, pid FROM child');
				await conn.query('CREATE VIEW a_top AS SELECT id FROM v_base');
				await conn.query('CREATE PROCEDURE p_count() SELECT COUNT(*) FROM child');
				await conn.query('CREATE FUNCTION f_one() RETURNS INT DETERMINISTIC RETURN 1');
				await conn.query('CREATE EVENT ev_noop ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1');
				// private configuration storage (same layout as sql/create_tables.sql)
				await conn.query(`CREATE DATABASE \`${pma}\``);
				await conn.query(
					`CREATE TABLE \`${pma}\`.pma__column_info (id int(5) unsigned NOT NULL auto_increment, ` +
						"db_name varchar(64) NOT NULL default '', table_name varchar(64) NOT NULL default '', " +
						"column_name varchar(64) NOT NULL default '', comment varchar(255) NOT NULL default '', " +
						"mimetype varchar(255) NOT NULL default '', transformation varchar(255) NOT NULL default '', " +
						"transformation_options varchar(255) NOT NULL default '', input_transformation varchar(255) NOT NULL default '', " +
						"input_transformation_options varchar(255) NOT NULL default '', PRIMARY KEY (id), " +
						'UNIQUE KEY db_name (db_name, table_name, column_name))'
				);
			} catch (e) {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable or not usable on ${port}, skipping`, e);
			}
		});
		afterAll(async () => {
			if (conn) await dropAll().catch(() => {});
			await conn?.end();
		});

		it('stores the database comment in pma__column_info', async ({ skip }) => {
			if (!conn) return skip();
			expect(await hasColumnInfo(dbi, storage)).toBe(true);
			expect(await getDbComment(dbi, storage, src)).toBe('');
			const res = await setDbComment(dbi, storage, src, "it's a comment");
			expect(res.error).toBeUndefined();
			expect(await getDbComment(dbi, storage, src)).toBe("it's a comment");
			const rows = await q(
				`SELECT column_name FROM \`${pma}\`.pma__column_info WHERE db_name='${src}'`
			);
			expect(rows[0].column_name).toBe('(db_comment)');
			await setDbComment(dbi, storage, src, '');
			expect(await getDbComment(dbi, storage, src)).toBe('');
			await setDbComment(dbi, storage, src, 'kept');
			expect(await hasColumnInfo(dbi, { ...storage, pmadb: 'sma_t3c_nope' })).toBe(false);
		});

		it('copies structure and data with view, routines, trigger and event', async ({ skip }) => {
			if (!conn) return skip();
			const res = await copyDatabase(
				dbi,
				src,
				{
					newName: copy,
					what: 'data',
					createDatabase: true,
					dropTable: false,
					autoIncrement: false,
					constraints: true,
					adjustPrivileges: false,
					switchToNew: true
				},
				{ afterCopy: (a, b, move) => transferColumnInfo(dbi, storage, a, b, move) }
			);
			expect(res.error).toBeUndefined();
			expect(res.ok).toBe(true);
			expect(res.goto).toBe(copy);
			expect(res.sql.length).toBeGreaterThan(8);

			expect(await getDatabaseCollation(dbi, copy)).toBe('latin1_swedish_ci');
			// data copied, and the trigger did not fire during the copy
			expect(
				(await q(`SELECT note FROM \`${copy}\`.child ORDER BY id`)).map((r) => r.note)
			).toEqual(['a', 'b', 'c']);
			expect((await q(`SELECT COUNT(*) AS n FROM \`${copy}\`.a_top`))[0].n).toBe(3);
			expect((await q(`SELECT COUNT(*) AS n FROM \`${copy}\`.v_base`))[0].n).toBe(3);
			expect((await q(`SELECT \`${copy}\`.f_one() AS v`))[0].v).toBe(1);
			expect(
				(
					await q(
						`SELECT ROUTINE_NAME AS n FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${copy}' ORDER BY 1`
					)
				).map((r) => r.n)
			).toEqual(['f_one', 'p_count']);
			expect(
				(
					await q(
						`SELECT EVENT_NAME AS n FROM information_schema.EVENTS WHERE EVENT_SCHEMA='${copy}'`
					)
				).map((r) => r.n)
			).toEqual(['ev_noop']);
			// the trigger was re-created and works in the copy
			await conn!.query(`INSERT INTO \`${copy}\`.child (pid, note) VALUES (1,'z')`);
			expect((await q(`SELECT note FROM \`${copy}\`.child WHERE id = 4`))[0].note).toBe('t-z');
			// foreign key re-created, AUTO_INCREMENT option not copied
			const create = String((await q(`SHOW CREATE TABLE \`${copy}\`.child`))[0]['Create Table']);
			expect(create).toMatch(/FOREIGN KEY \(`pid`\) REFERENCES `parent`/);
			// the original is untouched
			expect((await q(`SELECT COUNT(*) AS n FROM \`${src}\`.child`))[0].n).toBe(3);
			// pmadb rows (database comment) duplicated
			expect(await getDbComment(dbi, storage, copy)).toBe('kept');
		});

		it('refuses to copy onto the same name and reports server errors with the SQL', async ({
			skip
		}) => {
			if (!conn) return skip();
			const same = await copyDatabase(dbi, src, {
				newName: src,
				what: 'data',
				createDatabase: true,
				dropTable: false,
				autoIncrement: false,
				constraints: true,
				adjustPrivileges: false,
				switchToNew: false
			});
			expect(same.ok).toBe(false);
			expect(same.message).toMatch(/same name/);
			// copying again onto the existing tables fails with a table-exists error
			const again = await copyDatabase(dbi, src, {
				newName: copy,
				what: 'structure',
				createDatabase: true,
				dropTable: false,
				autoIncrement: false,
				constraints: true,
				adjustPrivileges: false,
				switchToNew: false
			});
			expect(again.ok).toBe(false);
			expect(again.error).toMatch(/already exists/i);
			expect(again.sql.at(-1)).toMatch(/^CREATE TABLE/);
			// with DROP TABLE it succeeds
			const dropped = await copyDatabase(dbi, src, {
				newName: copy,
				what: 'data',
				createDatabase: false,
				dropTable: true,
				autoIncrement: false,
				constraints: false,
				adjustPrivileges: false,
				switchToNew: false
			});
			expect(dropped.error).toBeUndefined();
			expect(dropped.ok).toBe(true);
			expect((await q(`SELECT COUNT(*) AS n FROM \`${copy}\`.child`))[0].n).toBe(3);
		});

		it('changes the collation of the database, tables and columns', async ({ skip }) => {
			if (!conn) return skip();
			const res = await changeCollation(dbi, copy, {
				collation: 'utf8mb4_bin',
				changeTables: true,
				changeColumns: true
			});
			expect(res.ok).toBe(true);
			expect(await getDatabaseCollation(dbi, copy)).toBe('utf8mb4_bin');
			const tables = await q(
				`SELECT TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA='${copy}' AND TABLE_TYPE='BASE TABLE'`
			);
			expect(tables.every((t) => t.c === 'utf8mb4_bin')).toBe(true);
			const cols = await q(
				`SELECT COLLATION_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${copy}' AND TABLE_NAME='parent' AND COLLATION_NAME IS NOT NULL`
			);
			expect(cols.every((t) => t.c === 'utf8mb4_bin')).toBe(true);
			const bad = await changeCollation(dbi, copy, {
				collation: 'nope_collation',
				changeTables: false,
				changeColumns: false
			});
			expect(bad.ok).toBe(false);
		});

		it('renames the database, keeping foreign keys, triggers, views and routines', async ({
			skip
		}) => {
			if (!conn) return skip();
			const res = await renameDatabase(
				dbi,
				src,
				{ newName: renamed, adjustPrivileges: false },
				{ afterCopy: (a, b, move) => transferColumnInfo(dbi, storage, a, b, move) }
			);
			expect(res.error).toBeUndefined();
			expect(res.ok).toBe(true);
			expect(res.goto).toBe(renamed);
			expect(res.sql.at(-1)).toBe(`DROP DATABASE \`${src}\``);
			expect(await dbi.databaseExists(src)).toBe(false);
			expect((await q(`SELECT COUNT(*) AS n FROM \`${renamed}\`.child`))[0].n).toBe(3);
			expect((await q(`SELECT COUNT(*) AS n FROM \`${renamed}\`.a_top`))[0].n).toBe(3);
			expect((await q(`SELECT \`${renamed}\`.f_one() AS v`))[0].v).toBe(1);
			expect(
				(
					await q(
						`SELECT EVENT_NAME AS n FROM information_schema.EVENTS WHERE EVENT_SCHEMA='${renamed}'`
					)
				).map((r) => r.n)
			).toEqual(['ev_noop']);
			const create = String((await q(`SHOW CREATE TABLE \`${renamed}\`.child`))[0]['Create Table']);
			expect(create).toMatch(/FOREIGN KEY \(`pid`\) REFERENCES `parent`/);
			expect(create).toMatch(/AUTO_INCREMENT=4/);
			expect(
				(
					await q(
						`SELECT TRIGGER_NAME AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${renamed}'`
					)
				).map((r) => r.n)
			).toEqual(['trg_child']);
			expect(await getDbComment(dbi, storage, renamed)).toBe('kept');
			expect(await getDbComment(dbi, storage, src)).toBe('');
			// renaming onto an existing database is refused
			const clash = await renameDatabase(dbi, renamed, { newName: copy, adjustPrivileges: false });
			expect(clash.ok).toBe(false);
			expect(clash.message).toMatch(/already exists/);
		});

		it('copies and moves database privileges', async ({ skip }) => {
			if (!conn) return skip();
			expect(await canAdjustPrivileges(dbi)).toBe(true);
			const user = `'sma_t3c_u'@'localhost'`;
			const a = 'sma_t3c_pa';
			const b = 'sma_t3c_pb';
			const c = 'sma_t3c_pc';
			try {
				await conn.query(`CREATE USER ${user} IDENTIFIED BY 'x'`);
				await conn.query(`GRANT SELECT ON \`sma\\_t3c\\_pa\`.* TO ${user}`);
				const dbs = async () =>
					(await q(`SELECT Db AS d FROM mysql.db WHERE User = 'sma_t3c_u' ORDER BY Db`)).map(
						(r) => r.d
					);
				expect(await dbs()).toEqual(['sma\\_t3c\\_pa']);
				const cp = await adjustPrivileges(conn, a, b, false);
				expect(cp.error).toBeUndefined();
				expect(await dbs()).toEqual(['sma\\_t3c\\_pa', 'sma\\_t3c\\_pb']);
				const mv = await adjustPrivileges(conn, b, c, true);
				expect(mv.error).toBeUndefined();
				expect(await dbs()).toEqual(['sma\\_t3c\\_pa', 'sma\\_t3c\\_pc']);
			} finally {
				await conn.query(`DROP USER IF EXISTS ${user}`);
			}
		});

		it('builds the data dictionary', async ({ skip }) => {
			if (!conn) return skip();
			const dict = await loadDataDictionary(dbi, storage, renamed);
			expect(dict.comment).toBe('kept');
			const child = dict.tables.find((t) => t.name === 'child')!;
			expect(child.hasRelation).toBe(true);
			const pid = child.columns.find((c) => c.name === 'pid')!;
			expect(pid.relation).toBe('parent -> id');
			expect(child.columns.find((c) => c.name === 'id')!.isPrimary).toBe(true);
			expect(child.columns.find((c) => c.name === 'COMMENT_COL')!.comment).toBe('hello');
			expect(child.indexes.map((i) => i.name)).toContain('PRIMARY');
			expect(dict.tables.map((t) => t.name)).toEqual(
				expect.arrayContaining(['a_top', 'child', 'parent', 'v_base'])
			);
		});
	});
}
