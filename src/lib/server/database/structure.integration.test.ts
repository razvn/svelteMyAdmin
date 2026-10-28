import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import {
	buildPlan,
	executePlan,
	getStructure,
	isViewType,
	loadRawTables,
	operationSchema,
	type OperationInput
} from './structure';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`database/structure against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const db = `tmp_t3a_int_${port}`;
		const opts = { maxExactCount: 50000, maxExactCountViews: 0 };

		const run = async (
			partial: Partial<OperationInput> & Pick<OperationInput, 'op' | 'selected'>
		) => {
			const tables = (await loadRawTables(dbi, db)).map((t) => ({
				name: t.name,
				isView: isViewType(t.type)
			}));
			const r = buildPlan(operationSchema.parse(partial), tables, db);
			if (!r.ok) throw new Error(r.error);
			return executePlan(dbi, r.plan);
		};
		const names = async () => (await loadRawTables(dbi, db)).map((t) => t.name).sort();

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
				await conn.query(`USE \`${db}\``);
				await conn.query(
					'CREATE TABLE a_users (id INT PRIMARY KEY) ENGINE=InnoDB COMMENT="people"'
				);
				await conn.query('INSERT INTO a_users VALUES (1),(2),(3)');
				await conn.query(
					'CREATE TABLE a_posts (id INT PRIMARY KEY, uid INT, FOREIGN KEY (uid) REFERENCES a_users(id)) ENGINE=InnoDB'
				);
				await conn.query('INSERT INTO a_posts VALUES (1,1)');
				await conn.query('CREATE TABLE b_myisam (id INT) ENGINE=MyISAM');
				await conn.query('INSERT INTO b_myisam VALUES (1),(2)');
				await conn.query('CREATE VIEW v_users AS SELECT id FROM a_users');
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn?.end();
		});

		it('lists tables with stats, exact counts and views', async ({ skip }) => {
			if (!conn) return skip();
			const s = await getStructure(dbi, db, {
				...opts,
				sort: 'name',
				sortOrder: 'asc',
				pos: 0,
				maxTableList: 250
			});
			expect(s.total).toBe(4);
			expect(s.rows.map((r) => r.name)).toEqual(['a_posts', 'a_users', 'b_myisam', 'v_users']);
			const users = s.rows.find((r) => r.name === 'a_users')!;
			expect(users.rows).toBe(3);
			expect(users.approx).toBe(false); // counted: below MaxExactCount
			expect(users.size).toBeGreaterThan(0);
			expect(users.comment).toBe('people');
			const view = s.rows.find((r) => r.name === 'v_users')!;
			expect(view.isView).toBe(true);
			expect(view.rows).toBeNull(); // MaxExactCountViews = 0
			expect(s.rows.find((r) => r.name === 'b_myisam')!.rows).toBe(2);
			expect(s.sums.rows).toBe(3 + 1 + 2);

			// MaxExactCount = 0 -> InnoDB estimate is kept and shown as approximate
			const approx = await getStructure(dbi, db, {
				maxExactCount: 0,
				maxExactCountViews: 10,
				sort: 'rows',
				sortOrder: 'desc',
				pos: 0,
				maxTableList: 250
			});
			expect(approx.rows.find((r) => r.name === 'a_users')!.approx).toBe(true);
			expect(approx.rows.find((r) => r.name === 'v_users')!.rows).toBe(3);
			expect(approx.rows.find((r) => r.name === 'v_users')!.approx).toBe(false);

			// pagination
			const p = await getStructure(dbi, db, {
				...opts,
				sort: 'name',
				sortOrder: 'desc',
				pos: 1,
				maxTableList: 2
			});
			expect(p.rows.map((r) => r.name)).toEqual(['b_myisam', 'a_users']);
		});

		it('runs check / analyze / optimize / repair / checksum and returns the result table', async ({
			skip
		}) => {
			if (!conn) return skip();
			for (const op of ['check', 'analyze', 'optimize', 'checksum'] as const) {
				const r = await run({ op, selected: ['a_users', 'b_myisam'] });
				expect(r.ok, op).toBe(true);
				if (r.ok) {
					expect(r.results).toHaveLength(1);
					expect(r.results[0].rows.length).toBeGreaterThanOrEqual(2);
					expect(Object.keys(r.results[0].rows[0])).toContain('Table');
				}
			}
			const rep = await run({ op: 'repair', selected: ['b_myisam'] });
			expect(rep.ok).toBe(true);
			if (rep.ok) expect(rep.results[0].rows[0].Table).toBe(`${db}.b_myisam`);
		});

		it('shows create statements for tables and views', async ({ skip }) => {
			if (!conn) return skip();
			const r = await run({ op: 'show_create', selected: ['a_users', 'v_users'] });
			expect(r.ok).toBe(true);
			if (r.ok) {
				expect(r.results[0].rows[0]['Create Table']).toContain('CREATE TABLE');
				expect(r.results[1].rows[0]['Create View']).toContain('VIEW');
			}
		});

		it('copies with prefix, adds and replaces prefixes', async ({ skip }) => {
			if (!conn) return skip();
			let r = await run({
				op: 'copy_prefix',
				selected: ['a_users'],
				from_prefix: 'a_',
				to_prefix: 'c_'
			});
			expect(r.ok).toBe(true);
			const [rows] = await conn.query(`SELECT COUNT(*) AS c FROM \`${db}\`.c_users`);
			expect(Number((rows as { c: unknown }[])[0].c)).toBe(3);

			r = await run({ op: 'add_prefix', selected: ['c_users', 'b_myisam'], prefix: 'x_' });
			expect(r.ok).toBe(true);
			expect(await names()).toEqual(
				['a_posts', 'a_users', 'v_users', 'x_b_myisam', 'x_c_users'].sort()
			);

			r = await run({
				op: 'replace_prefix',
				selected: ['x_c_users', 'x_b_myisam'],
				from_prefix: 'x_',
				to_prefix: 'y_'
			});
			expect(r.ok).toBe(true);
			expect(await names()).toContain('y_b_myisam');

			// renaming onto an existing table is refused before anything runs
			await expect(
				run({ op: 'replace_prefix', selected: ['y_c_users'], from_prefix: 'y_c_', to_prefix: 'a_' })
			).rejects.toThrow(/already exists/);
		});

		it('empties tables (FK checks off), skipping views', async ({ skip }) => {
			if (!conn) return skip();
			// TRUNCATE on a table referenced by a foreign key fails with checks enabled
			const fail = await run({ op: 'empty', selected: ['a_users'] });
			expect(fail.ok).toBe(false);
			const ok = await run({ op: 'empty', selected: ['a_users', 'v_users'], fk_checks: false });
			expect(ok.ok).toBe(true);
			const [rows] = await conn.query(`SELECT COUNT(*) AS c FROM \`${db}\`.a_users`);
			expect(Number((rows as { c: unknown }[])[0].c)).toBe(0);
			// the session setting was restored
			const [fk] = await conn.query('SELECT @@foreign_key_checks AS v');
			expect(Number((fk as { v: unknown }[])[0].v)).toBe(1);
		});

		it('drops tables and views', async ({ skip }) => {
			if (!conn) return skip();
			// referenced table cannot be dropped with checks on
			const blocked = await run({ op: 'drop', selected: ['a_users'] });
			expect(blocked.ok).toBe(false);
			const r = await run({
				op: 'drop',
				selected: ['a_users', 'a_posts', 'v_users'],
				fk_checks: false
			});
			expect(r.ok).toBe(true);
			expect(await names()).not.toContain('a_users');
			expect(await names()).not.toContain('v_users');
		});
	});
}
