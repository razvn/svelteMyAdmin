import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import {
	applyOptions,
	copyTable,
	dropTable,
	emptyTable,
	getPartitions,
	getTableStatus,
	hasClusteredKey,
	hasForeignKeys,
	listUsableEngines,
	maintainPartitions,
	maintainTable,
	moveTable,
	reorderTable,
	type OptionsInput,
	type TableMetaServer
} from './operations';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`table/operations against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const a = `tmp_t4d_a_${port}`;
		const b = `tmp_t4d_b_${port}`;
		const pma = `tmp_t4d_pma_${port}`;
		const all = [a, b, pma];
		const meta: TableMetaServer = {
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
			relation: 'pma__relation',
			table_info: 'pma__table_info'
		};
		/** Rows with numeric strings (COUNT, @@vars) turned into numbers. */
		const q = async (sql: string) =>
			((await conn!.query(sql))[0] as Record<string, unknown>[]).map((r) =>
				Object.fromEntries(
					Object.entries(r).map(([k, v]) => [
						k,
						typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v
					])
				)
			);
		const noOpts: OptionsInput = {
			newName: '',
			adjustPrivileges: false,
			changeAllCollations: false
		};
		const opts = (o: Partial<OptionsInput>): OptionsInput => ({ ...noOpts, ...o });
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
				await conn.query(`CREATE DATABASE \`${a}\` DEFAULT CHARACTER SET utf8mb4`);
				await conn.query(`CREATE DATABASE \`${b}\` DEFAULT CHARACTER SET utf8mb4`);
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
				await conn.query(
					`CREATE TABLE \`${pma}\`.pma__table_info (db_name varchar(64) NOT NULL default '', ` +
						"table_name varchar(64) NOT NULL default '', display_field varchar(64) NOT NULL default '', " +
						'PRIMARY KEY (db_name, table_name))'
				);
				await conn.query(
					`CREATE TABLE \`${pma}\`.pma__relation (master_db varchar(64) NOT NULL default '', ` +
						"master_table varchar(64) NOT NULL default '', master_field varchar(64) NOT NULL default '', " +
						"foreign_db varchar(64) NOT NULL default '', foreign_table varchar(64) NOT NULL default '', " +
						"foreign_field varchar(64) NOT NULL default '', PRIMARY KEY (master_db, master_table, master_field))"
				);
				await conn.query(`USE \`${a}\``);
			} catch (e) {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable or not usable on ${port}, skipping`, e);
			}
		});
		afterAll(async () => {
			if (conn) await dropAll().catch(() => {});
			await conn?.end();
		});

		it('renames a table and carries the configuration storage rows along', async ({ skip }) => {
			if (!conn) return skip();
			await conn.query(`CREATE TABLE \`${a}\`.t_old (id INT PRIMARY KEY, v VARCHAR(10))`);
			await conn.query(`INSERT INTO \`${a}\`.t_old VALUES (1,'x'),(2,'y')`);
			await conn.query(
				`INSERT INTO \`${pma}\`.pma__column_info (db_name, table_name, column_name, comment) VALUES ('${a}','t_old','v','note')`
			);
			await conn.query(`INSERT INTO \`${pma}\`.pma__table_info VALUES ('${a}','t_old','v')`);
			const res = await moveTable(
				dbi,
				a,
				't_old',
				{ targetDb: a, newName: 't_new', adjustPrivileges: false },
				meta
			);
			expect(res.error).toBeUndefined();
			expect(res.ok).toBe(true);
			expect(res.sql[0]).toBe(`RENAME TABLE \`${a}\`.\`t_old\` TO \`${a}\`.\`t_new\``);
			expect(res.goto).toBe(`/db/${a}/table/t_new/operations`);
			expect(await dbi.getTableType(a, 't_old')).toBeNull();
			expect(await q(`SELECT COUNT(*) AS n FROM \`${a}\`.t_new`)).toEqual([{ n: 2 }]);
			expect(
				await q(`SELECT table_name AS t FROM \`${pma}\`.pma__column_info WHERE db_name='${a}'`)
			).toEqual([{ t: 't_new' }]);
			expect(
				await q(`SELECT table_name AS t FROM \`${pma}\`.pma__table_info WHERE db_name='${a}'`)
			).toEqual([{ t: 't_new' }]);
		});

		it('refuses invalid or clashing targets', async ({ skip }) => {
			if (!conn) return skip();
			await conn.query(`CREATE TABLE \`${a}\`.clash (id INT)`);
			const bad = await moveTable(
				dbi,
				a,
				't_new',
				{ targetDb: a, newName: 'clash', adjustPrivileges: false },
				meta
			);
			expect(bad.ok).toBe(false);
			expect(bad.message).toMatch(/already exists/);
			const dot = await moveTable(
				dbi,
				a,
				't_new',
				{ targetDb: a, newName: 'a.b', adjustPrivileges: false },
				meta
			);
			expect(dot.ok).toBe(false);
			const nodb = await moveTable(
				dbi,
				a,
				't_new',
				{ targetDb: 'tmp_t4d_nope', newName: 'z', adjustPrivileges: false },
				meta
			);
			expect(nodb.message).toMatch(/not found/);
			await conn.query(`DROP TABLE \`${a}\`.clash`);
		});

		it('moves a table with a trigger to another database', async ({ skip }) => {
			if (!conn) return skip();
			await conn.query(
				`CREATE TABLE \`${a}\`.mv (id INT AUTO_INCREMENT PRIMARY KEY, note VARCHAR(20))`
			);
			await conn.query(
				`CREATE TRIGGER \`${a}\`.trg_mv BEFORE INSERT ON \`${a}\`.mv FOR EACH ROW SET NEW.note = CONCAT('t-', NEW.note)`
			);
			const res = await moveTable(
				dbi,
				a,
				'mv',
				{ targetDb: b, newName: 'mv2', adjustPrivileges: false },
				meta
			);
			expect(res.error).toBeUndefined();
			expect(res.ok).toBe(true);
			expect(await dbi.getTableType(a, 'mv')).toBeNull();
			expect((await dbi.listTriggers(a)).filter((t) => t.table === 'mv')).toEqual([]);
			const trg = (await dbi.listTriggers(b)).filter((t) => t.table === 'mv2');
			expect(trg.map((t) => t.name)).toEqual(['trg_mv']);
			await conn.query(`INSERT INTO \`${b}\`.mv2 (note) VALUES ('x')`);
			expect(await q(`SELECT note FROM \`${b}\`.mv2`)).toEqual([{ note: 't-x' }]);
			await conn.query(`DROP TABLE \`${b}\`.mv2`);
		});

		it('changes comment, engine, auto_increment and the collation of all columns in one go', async ({
			skip
		}) => {
			if (!conn) return skip();
			await conn.query(
				`CREATE TABLE \`${a}\`.opt (id INT AUTO_INCREMENT PRIMARY KEY, s VARCHAR(10)) ENGINE=InnoDB COMMENT='first'`
			);
			const engines = await listUsableEngines(dbi);
			expect(engines).toContain('InnoDB');
			let st = (await getTableStatus(dbi, a, 'opt'))!;
			expect(st.options.comment).toBe('first');
			expect(st.options.engine).toBe('InnoDB');

			// nothing changed -> no statement at all
			const none = await applyOptions(
				dbi,
				a,
				'opt',
				opts({ comment: 'first', engine: 'innodb' }),
				meta
			);
			expect(none).toMatchObject({ ok: true, message: 'No change', sql: [] });

			const r1 = await applyOptions(
				dbi,
				a,
				'opt',
				opts({
					comment: "it's new",
					engine: 'MyISAM',
					autoIncrement: '77',
					collation: 'latin1_swedish_ci',
					charset: 'latin1',
					changeAllCollations: true
				}),
				meta
			);
			expect(r1.error).toBeUndefined();
			expect(r1.ok).toBe(true);
			// one ALTER (comment + engine + auto_increment) plus the column conversion
			expect(r1.sql).toHaveLength(2);
			expect(r1.sql[0]).toContain('ENGINE = `MyISAM`');
			st = (await getTableStatus(dbi, a, 'opt'))!;
			expect(st.options).toMatchObject({
				comment: "it's new",
				engine: 'MyISAM',
				autoIncrement: '77',
				collation: 'latin1_swedish_ci'
			});
			const col = await q(
				`SELECT COLLATION_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${a}' AND TABLE_NAME='opt' AND COLUMN_NAME='s'`
			);
			expect(col).toEqual([{ c: 'latin1_swedish_ci' }]);

			// MyISAM specific options
			const r2 = await applyOptions(
				dbi,
				a,
				'opt',
				opts({ packKeys: '1', checksum: true, delayKeyWrite: true, rowFormat: 'FIXED' }),
				meta
			);
			expect(r2.error).toBeUndefined();
			expect(r2.ok).toBe(true);
			st = (await getTableStatus(dbi, a, 'opt'))!;
			expect(st.options).toMatchObject({ packKeys: '1', checksum: true, delayKeyWrite: true });
			expect(st.options.rowFormat.toUpperCase()).toBe('FIXED');

			// MyISAM-only options must be reset before InnoDB accepts the table
			const r2b = await applyOptions(
				dbi,
				a,
				'opt',
				opts({ packKeys: 'DEFAULT', checksum: false, delayKeyWrite: false, rowFormat: 'DYNAMIC' }),
				meta
			);
			expect(r2b.error).toBeUndefined();
			// and back to InnoDB, renamed at the same time
			const r3 = await applyOptions(
				dbi,
				a,
				'opt',
				opts({ engine: 'InnoDB', newName: 'opt2' }),
				meta
			);
			expect(r3.error).toBeUndefined();
			expect(r3.goto).toBe(`/db/${a}/table/opt2/operations`);
			expect((await getTableStatus(dbi, a, 'opt2'))!.options.engine).toBe('InnoDB');
			expect(await dbi.getTableType(a, 'opt')).toBeNull();
		});

		it('switches between InnoDB and Aria on MariaDB', async ({ skip }) => {
			if (!conn) return skip();
			if (!(await listUsableEngines(dbi)).includes('Aria')) return skip();
			await conn.query(`CREATE TABLE \`${a}\`.ar (id INT PRIMARY KEY, v INT) ENGINE=InnoDB`);
			const r1 = await applyOptions(dbi, a, 'ar', opts({ engine: 'Aria' }), meta);
			expect(r1.error).toBeUndefined();
			expect((await getTableStatus(dbi, a, 'ar'))!.options.engine).toBe('Aria');
			const r2 = await applyOptions(
				dbi,
				a,
				'ar',
				opts({ transactional: false, pageChecksum: false, checksum: true }),
				meta
			);
			expect(r2.error).toBeUndefined();
			expect(r2.sql[0]).toMatch(/TRANSACTIONAL = 0/);
			const st = (await getTableStatus(dbi, a, 'ar'))!;
			expect(st.options).toMatchObject({
				transactional: false,
				pageChecksum: false,
				checksum: true
			});
			const r3 = await applyOptions(dbi, a, 'ar', opts({ engine: 'InnoDB' }), meta);
			expect(r3.error).toBeUndefined();
			expect((await getTableStatus(dbi, a, 'ar'))!.options.engine).toBe('InnoDB');
		});

		it('reorders a MyISAM table and flags InnoDB clustered keys', async ({ skip }) => {
			if (!conn) return skip();
			await conn.query(`CREATE TABLE \`${a}\`.ro (id INT, v INT) ENGINE=MyISAM`);
			await conn.query(`INSERT INTO \`${a}\`.ro VALUES (1,30),(2,10),(3,20)`);
			const res = await reorderTable(dbi, a, 'ro', 'v', 'desc');
			expect(res.error).toBeUndefined();
			expect(res.ok).toBe(true);
			expect(res.sql).toEqual([`ALTER TABLE \`ro\` ORDER BY \`v\` DESC`]);
			expect((await q(`SELECT v FROM \`${a}\`.ro`)).map((r) => r.v)).toEqual([30, 20, 10]);
			expect((await reorderTable(dbi, a, 'ro', 'nope', 'asc')).ok).toBe(false);
			await conn.query(`CREATE TABLE \`${a}\`.ro_pk (id INT PRIMARY KEY, v INT) ENGINE=InnoDB`);
			await conn.query(`CREATE TABLE \`${a}\`.ro_np (id INT, v INT) ENGINE=InnoDB`);
			expect(await hasClusteredKey(dbi, a, 'ro_pk')).toBe(true);
			expect(await hasClusteredKey(dbi, a, 'ro_np')).toBe(false);
		});

		describe('copy', () => {
			beforeAll(async () => {
				if (!conn) return;
				await conn.query(`USE \`${a}\``);
				await conn.query(
					'CREATE TABLE parent (id INT PRIMARY KEY, label VARCHAR(20)) ENGINE=InnoDB'
				);
				await conn.query(
					'CREATE TABLE child (id INT AUTO_INCREMENT PRIMARY KEY, pid INT, note VARCHAR(20), ' +
						'dbl INT AS (pid * 2) VIRTUAL, CONSTRAINT fk_child FOREIGN KEY (pid) REFERENCES parent (id)) ENGINE=InnoDB'
				);
				await conn.query("INSERT INTO parent VALUES (1,'one'),(2,'two')");
				await conn.query("INSERT INTO child (pid, note) VALUES (1,'a'),(2,'b'),(2,'c')");
				await conn.query(
					"CREATE TRIGGER trg_child BEFORE INSERT ON child FOR EACH ROW SET NEW.note = CONCAT('t-', NEW.note)"
				);
				await conn.query(
					`INSERT INTO \`${pma}\`.pma__column_info (db_name, table_name, column_name, comment) VALUES ('${a}','child','note','the note')`
				);
				await conn.query(
					`INSERT INTO \`${pma}\`.pma__relation VALUES ('${a}','child','pid','${a}','parent','id')`
				);
			});

			const base = {
				what: 'data' as const,
				dropTable: false,
				autoIncrement: false,
				constraints: true,
				adjustPrivileges: false,
				switchToNew: false
			};

			it('copies structure and data to a new name in the same db (FK kept, no trigger clash)', async ({
				skip
			}) => {
				if (!conn) return skip();
				expect(await hasForeignKeys(dbi, a, 'child')).toBe(true);
				const res = await copyTable(
					dbi,
					a,
					'child',
					{ ...base, targetDb: a, newName: 'child_copy' },
					meta
				);
				expect(res.error).toBeUndefined();
				expect(res.ok).toBe(true);
				expect(await q(`SELECT COUNT(*) AS n FROM \`${a}\`.child_copy`)).toEqual([{ n: 3 }]);
				// generated column is not copied as a value but still exists
				expect(await q(`SELECT dbl FROM \`${a}\`.child_copy ORDER BY id`)).toEqual([
					{ dbl: 2 },
					{ dbl: 4 },
					{ dbl: 4 }
				]);
				const create = String(
					(await q(`SHOW CREATE TABLE \`${a}\`.child_copy`))[0]['Create Table']
				);
				expect(create).toContain('FOREIGN KEY');
				// the statement sent had no AUTO_INCREMENT=n option (the counter simply follows the data)
				expect(res.sql.find((x) => x.startsWith('CREATE TABLE'))).not.toContain('AUTO_INCREMENT=');
				expect((await dbi.listTriggers(a)).filter((t) => t.table === 'child_copy')).toEqual([]);
				// storage rows duplicated
				expect(
					await q(
						`SELECT comment AS c FROM \`${pma}\`.pma__column_info WHERE db_name='${a}' AND table_name='child_copy'`
					)
				).toEqual([{ c: 'the note' }]);
				expect(
					await q(
						`SELECT foreign_table AS f FROM \`${pma}\`.pma__relation WHERE master_table='child_copy'`
					)
				).toEqual([{ f: 'parent' }]);
				await conn.query(`DROP TABLE \`${a}\`.child_copy`);
			});

			it('copies to another database with trigger, constraints and AUTO_INCREMENT', async ({
				skip
			}) => {
				if (!conn) return skip();
				// the target db needs the referenced table for the constraint
				await conn.query(`CREATE TABLE \`${b}\`.parent (id INT PRIMARY KEY, label VARCHAR(20))`);
				const res = await copyTable(
					dbi,
					a,
					'child',
					{ ...base, targetDb: b, newName: 'child', autoIncrement: true },
					meta
				);
				expect(res.error).toBeUndefined();
				expect(res.ok).toBe(true);
				expect(await q(`SELECT COUNT(*) AS n FROM \`${b}\`.child`)).toEqual([{ n: 3 }]);
				const create = String((await q(`SHOW CREATE TABLE \`${b}\`.child`))[0]['Create Table']);
				expect(create).toContain('AUTO_INCREMENT=4');
				expect(create).toContain('FOREIGN KEY');
				// the trigger exists in both databases, and the source one still works
				expect((await dbi.listTriggers(b)).map((t) => t.table)).toEqual(['child']);
				expect((await dbi.listTriggers(a)).map((t) => t.table)).toContain('child');
				// the copy fired no trigger while loading the data (rows were inserted before the trigger existed)
				expect((await q(`SELECT note FROM \`${b}\`.child ORDER BY id`)).map((r) => r.note)).toEqual(
					['a', 'b', 'c']
				);
				expect(res.goto).toBeUndefined();
			});

			it('structure only, data only and DROP TABLE', async ({ skip }) => {
				if (!conn) return skip();
				const s = await copyTable(
					dbi,
					a,
					'parent',
					{ ...base, what: 'structure', targetDb: a, newName: 'parent_s', switchToNew: true },
					meta
				);
				expect(s.ok).toBe(true);
				expect(s.goto).toBe(`/db/${a}/table/parent_s/operations`);
				expect(await q(`SELECT COUNT(*) AS n FROM \`${a}\`.parent_s`)).toEqual([{ n: 0 }]);
				const d = await copyTable(
					dbi,
					a,
					'parent',
					{ ...base, what: 'dataonly', targetDb: a, newName: 'parent_s' },
					meta
				);
				expect(d.error).toBeUndefined();
				expect(await q(`SELECT COUNT(*) AS n FROM \`${a}\`.parent_s`)).toEqual([{ n: 2 }]);
				const clash = await copyTable(
					dbi,
					a,
					'parent',
					{ ...base, targetDb: a, newName: 'parent_s' },
					meta
				);
				expect(clash.ok).toBe(false);
				expect(clash.message).toMatch(/already exists/);
				const repl = await copyTable(
					dbi,
					a,
					'parent',
					{ ...base, dropTable: true, targetDb: a, newName: 'parent_s' },
					meta
				);
				expect(repl.error).toBeUndefined();
				expect(repl.sql.some((s) => s.startsWith('DROP TABLE IF EXISTS'))).toBe(true);
				expect(await q(`SELECT COUNT(*) AS n FROM \`${a}\`.parent_s`)).toEqual([{ n: 2 }]);
				const self = await copyTable(
					dbi,
					a,
					'parent',
					{ ...base, targetDb: a, newName: 'parent' },
					meta
				);
				expect(self.ok).toBe(false);
				const nodata = await copyTable(
					dbi,
					a,
					'parent',
					{ ...base, what: 'dataonly', targetDb: a, newName: 'missing_target' },
					meta
				);
				expect(nodata.ok).toBe(false);
				await conn.query(`DROP TABLE \`${a}\`.parent_s`);
			});

			it('keeps the session state of the connection', async ({ skip }) => {
				if (!conn) return skip();
				const r = await q('SELECT @@foreign_key_checks AS fk, DATABASE() AS d');
				expect(r[0]).toMatchObject({ fk: 1, d: a });
			});
		});

		it('runs the maintenance operations', async ({ skip }) => {
			if (!conn) return skip();
			await conn.query(`CREATE TABLE \`${a}\`.mt (id INT PRIMARY KEY) ENGINE=InnoDB`);
			await conn.query(`INSERT INTO \`${a}\`.mt VALUES (1)`);
			for (const action of ['analyze', 'check', 'checksum', 'optimize'] as const) {
				const r = await maintainTable(dbi, a, 'mt', action, false);
				expect(r.error, action).toBeUndefined();
				expect(r.ok, action).toBe(true);
				expect(r.results?.[0].rows.length).toBeGreaterThan(0);
			}
			const defrag = await maintainTable(dbi, a, 'mt', 'defragment', false);
			expect(defrag.ok).toBe(true);
			expect(defrag.sql).toEqual([`ALTER TABLE \`${a}\`.\`mt\` ENGINE = InnoDB`]);
			const flush = await maintainTable(dbi, a, 'mt', 'flush', false);
			expect(flush.ok).toBe(true);
			expect(flush.message).toBe('Table mt has been flushed.');
			await conn.query(`CREATE TABLE \`${a}\`.mt_my (id INT) ENGINE=MyISAM`);
			const repair = await maintainTable(dbi, a, 'mt_my', 'repair', false);
			expect(repair.ok).toBe(true);
			await conn.query(`CREATE VIEW \`${a}\`.mt_view AS SELECT id FROM \`${a}\`.mt`);
			expect((await maintainTable(dbi, a, 'mt_view', 'check', true)).ok).toBe(true);
			expect((await maintainTable(dbi, a, 'mt_view', 'optimize', true)).ok).toBe(false);
			await conn.query(`DROP VIEW \`${a}\`.mt_view`);
		});

		it('truncates (with and without FK checks) and drops', async ({ skip }) => {
			if (!conn) return skip();
			// parent is referenced by child (see copy tests)
			const blocked = await emptyTable(dbi, a, 'parent', true);
			expect(blocked.ok).toBe(false);
			expect(await q(`SELECT COUNT(*) AS n FROM \`${a}\`.parent`)).toEqual([{ n: 2 }]);
			const forced = await emptyTable(dbi, a, 'parent', false);
			expect(forced.error).toBeUndefined();
			expect(forced.ok).toBe(true);
			expect(forced.sql).toEqual([`TRUNCATE TABLE \`${a}\`.\`parent\``]);
			expect(await q(`SELECT COUNT(*) AS n FROM \`${a}\`.parent`)).toEqual([{ n: 0 }]);
			expect((await q('SELECT @@foreign_key_checks AS fk'))[0].fk).toBe(1);

			const dropBlocked = await dropTable(dbi, a, 'parent', false, true);
			expect(dropBlocked.ok).toBe(false);
			const dropped = await dropTable(dbi, a, 'child', false, true);
			expect(dropped.ok).toBe(true);
			expect(dropped.goto).toBe(`/db/${a}/structure`);
			expect(await dbi.getTableType(a, 'child')).toBeNull();
			await conn.query(`CREATE VIEW \`${a}\`.dv AS SELECT 1 AS x`);
			const dv = await dropTable(dbi, a, 'dv', true, true);
			expect(dv.sql).toEqual([`DROP VIEW \`${a}\`.\`dv\``]);
			expect(dv.message).toBe('View dv has been dropped.');
		});

		it('runs partition maintenance and removes partitioning', async ({ skip }) => {
			if (!conn) return skip();
			await conn.query(
				`CREATE TABLE \`${a}\`.pt (id INT NOT NULL, v INT) ENGINE=InnoDB PARTITION BY RANGE (id) (` +
					'PARTITION p0 VALUES LESS THAN (10), PARTITION p1 VALUES LESS THAN (20), ' +
					'PARTITION p2 VALUES LESS THAN MAXVALUE)'
			);
			await conn.query(`INSERT INTO \`${a}\`.pt VALUES (1,1),(15,2),(100,3)`);
			const parts = await getPartitions(dbi, a, 'pt');
			expect(parts).toEqual({ names: ['p0', 'p1', 'p2'], method: 'RANGE' });
			expect(await getPartitions(dbi, a, 'ro')).toBeNull();

			for (const op of ['ANALYZE', 'CHECK', 'OPTIMIZE', 'REBUILD'] as const) {
				const r = await maintainPartitions(dbi, a, 'pt', op, ['p0', 'p1']);
				expect(r.error, op).toBeUndefined();
				expect(r.ok, op).toBe(true);
			}
			const analyze = await maintainPartitions(dbi, a, 'pt', 'ANALYZE', ['p0']);
			expect(analyze.sql).toEqual(['ALTER TABLE `pt` ANALYZE PARTITION `p0`']);
			expect(analyze.results?.[0].rows.length).toBeGreaterThan(0);

			const trunc = await maintainPartitions(dbi, a, 'pt', 'TRUNCATE', ['p0']);
			expect(trunc.ok).toBe(true);
			expect(await q(`SELECT COUNT(*) AS n FROM \`${a}\`.pt`)).toEqual([{ n: 2 }]);

			// COALESCE is for HASH/KEY only
			expect((await maintainPartitions(dbi, a, 'pt', 'COALESCE', ['p0'])).ok).toBe(false);
			expect((await maintainPartitions(dbi, a, 'pt', 'ANALYZE', ['nope'])).ok).toBe(false);
			const drop = await maintainPartitions(dbi, a, 'pt', 'DROP', ['p1']);
			expect(drop.error).toBeUndefined();
			expect((await getPartitions(dbi, a, 'pt'))!.names).toEqual(['p0', 'p2']);

			const rm = await maintainPartitions(dbi, a, 'pt', null, []);
			expect(rm.error).toBeUndefined();
			expect(rm.sql).toEqual(['ALTER TABLE `pt` REMOVE PARTITIONING']);
			expect(await getPartitions(dbi, a, 'pt')).toBeNull();
			expect(await q(`SELECT COUNT(*) AS n FROM \`${a}\`.pt`)).toEqual([{ n: 1 }]);
		});
	});
}
