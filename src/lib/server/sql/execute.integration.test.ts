import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { isBinaryCell } from '#lib/components/results/format.ts';
import { verifyClause } from '#lib/server/table/signed-clause.ts';
import { runScript, type StatementOk } from './execute.ts';
import { createRowKeyResolver } from './row-keys.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];
const SECRET = 'test-secret';

for (const { name, port } of servers) {
	describe(`sql/execute against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const db = `tmp_t5a_int_${port}`;

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
				await conn.query(
					`CREATE TABLE \`${db}\`.big (id int NOT NULL PRIMARY KEY, label varchar(20) NOT NULL, b blob NULL)`
				);
				await conn.query(
					`INSERT INTO \`${db}\`.big (id, label, b) SELECT seq, CONCAT('row ', seq), UNHEX('00FF') FROM (
						WITH RECURSIVE s(seq) AS (SELECT 1 UNION ALL SELECT seq + 1 FROM s WHERE seq < 120) SELECT seq FROM s) x`
				);
				await conn.query(`CREATE TABLE \`${db}\`.nokey (a int, b int)`);
				await conn.query(`INSERT INTO \`${db}\`.nokey VALUES (1, 2)`);
			} catch {
				conn = undefined;
			}
		});

		afterAll(async () => {
			if (!conn) return;
			await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn.end();
		});

		const live = (fn: () => Promise<void>) => async (ctx: { skip: () => void }) => {
			if (!conn) return ctx.skip();
			await fn();
		};
		const ok = (s: { ok: boolean }) => s as StatementOk;

		it(
			'runs a multi statement script with DELIMITER, procedure and multiple result sets',
			live(async () => {
				const script = `
DELIMITER $$
CREATE PROCEDURE p() BEGIN SELECT 1 AS a, 'x' AS b; SELECT 2 AS c; END$$
DELIMITER ;
CALL p();
SELECT 3 AS d;`;
				const res = await runScript(conn!, script, { db });
				expect(res.statements).toHaveLength(3);
				expect(res.statements.every((s) => s.ok)).toBe(true);
				const call = ok(res.statements[1]);
				expect(call.kind).toBe('other');
				expect(call.resultSets).toHaveLength(2);
				expect(call.resultSets[0].fields.map((f) => f.name)).toEqual(['a', 'b']);
				expect(call.resultSets[0].rows).toEqual([['1', 'x']]);
				expect(call.resultSets[1].rows).toEqual([['2']]);
				expect(ok(res.statements[2]).resultSets[0].rows).toEqual([['3']]);
			})
		);

		it(
			'reports DML affected rows and insert id',
			live(async () => {
				const res = await runScript(
					conn!,
					`CREATE TABLE t_ai (id int AUTO_INCREMENT PRIMARY KEY, v int);
INSERT INTO t_ai (v) VALUES (1),(2),(3);
UPDATE t_ai SET v = v + 1 WHERE id > 1;
DELETE FROM t_ai WHERE id = 1`,
					{ db }
				);
				const [ddl, ins, upd, del] = res.statements.map(ok);
				expect(ddl.kind).toBe('ddl');
				expect(ins.kind).toBe('dml');
				expect(ins.affectedRows).toBe(3);
				expect(ins.insertId).toBe('1');
				expect(upd.affectedRows).toBe(2);
				expect(del.affectedRows).toBe(1);
				expect(del.resultSets).toHaveLength(0);
			})
		);

		it(
			'collects warnings',
			live(async () => {
				const res = await runScript(
					conn!,
					`SELECT CAST('a' AS SIGNED) AS n; DROP TABLE IF EXISTS nope`,
					{
						db
					}
				);
				const sel = ok(res.statements[0]);
				expect(sel.warnings.length).toBeGreaterThan(0);
				expect(sel.warnings[0].code).toBe(1292);
				const drop = ok(res.statements[1]);
				expect(drop.warnings.some((w) => w.code === 1051)).toBe(true);
			})
		);

		it(
			'stops at the first error, or continues on request',
			live(async () => {
				const script = 'SELECT 1; SELEC 2; SELECT 3';
				const stop = await runScript(conn!, script, { db });
				expect(stop.statements).toHaveLength(2);
				expect(stop.stopped).toBe(true);
				const bad = stop.statements[1];
				expect(bad.ok).toBe(false);
				if (!bad.ok) {
					expect(bad.error.errno).toBe(1064);
					expect(bad.errorRange).not.toBeNull();
					expect(bad.sql.slice(bad.errorRange!.start)).toContain('SELEC');
				}
				const cont = await runScript(conn!, script, { db, continueOnError: true });
				expect(cont.statements.map((s) => s.ok)).toEqual([true, false, true]);
				expect(cont.stopped).toBe(false);
			})
		);

		it(
			'paginates a big SELECT with LIMIT and a total count',
			live(async () => {
				const p0 = ok(
					(await runScript(conn!, 'SELECT * FROM big ORDER BY id', { db, maxRows: 50 }))
						.statements[0]
				);
				expect(p0.executedSql).toMatch(/LIMIT 0, 50$/);
				expect(p0.resultSets[0].rows).toHaveLength(50);
				expect(p0.pagination).toEqual({ pos: 0, size: 50, total: 120, hasMore: true });
				const p2 = ok(
					(await runScript(conn!, 'SELECT * FROM big ORDER BY id', { db, maxRows: 50, pos: 100 }))
						.statements[0]
				);
				expect(p2.resultSets[0].rows).toHaveLength(20);
				expect(p2.resultSets[0].rows[0][0]).toBe('101');
				expect(p2.pagination).toEqual({ pos: 100, size: 50, total: 120, hasMore: false });
				// small result: counted without a second query
				const small = ok((await runScript(conn!, 'SELECT * FROM nokey', { db })).statements[0]);
				expect(small.pagination?.total).toBe(1);
				// explicit LIMIT: untouched, no pagination
				const lim = ok((await runScript(conn!, 'SELECT * FROM big LIMIT 3', { db })).statements[0]);
				expect(lim.pagination).toBeNull();
				expect(lim.resultSets[0].rows).toHaveLength(3);
			})
		);

		it(
			'caps rows per result set',
			live(async () => {
				const s = ok(
					(await runScript(conn!, 'SELECT * FROM big LIMIT 100', { db, maxTotalRows: 10 }))
						.statements[0]
				);
				expect(s.resultSets[0].rows).toHaveLength(10);
				expect(s.resultSets[0].truncated).toBe(true);
			})
		);

		it(
			'encodes binary values and describes fields',
			live(async () => {
				const s = ok(
					(await runScript(conn!, 'SELECT id, label, b FROM big WHERE id = 1', { db }))
						.statements[0]
				);
				const [id, label, b] = s.resultSets[0].fields;
				expect(id).toMatchObject({
					name: 'id',
					orgName: 'id',
					orgTable: 'big',
					db,
					key: 'PRI',
					kind: 'integer'
				});
				expect(label.kind).toBe('text');
				expect(b.kind).toBe('binary');
				const cell = s.resultSets[0].rows[0][2];
				expect(isBinaryCell(cell)).toBe(true);
				expect(cell).toEqual({ bytes: 2, preview: '00ff' });
			})
		);

		it(
			'rolls back on request',
			live(async () => {
				await conn!.query(`CREATE TABLE \`${db}\`.rb (id int) ENGINE=InnoDB`);
				const res = await runScript(conn!, 'INSERT INTO rb VALUES (1); INSERT INTO rb VALUES (2)', {
					db,
					rollback: true
				});
				expect(res.rolledBack).toBe(true);
				expect(ok(res.statements[1]).affectedRows).toBe(1);
				const [rows] = await conn!.query(`SELECT COUNT(*) AS c FROM \`${db}\`.rb`);
				expect(Number((rows as { c: unknown }[])[0].c)).toBe(0);
			})
		);

		it(
			'disables foreign key checks',
			live(async () => {
				await conn!.query(`CREATE TABLE \`${db}\`.par (id int PRIMARY KEY) ENGINE=InnoDB`);
				await conn!.query(
					`CREATE TABLE \`${db}\`.chi (id int PRIMARY KEY, p int, FOREIGN KEY (p) REFERENCES par(id)) ENGINE=InnoDB`
				);
				const on = await runScript(conn!, 'INSERT INTO chi VALUES (1, 99)', { db });
				expect(on.statements[0].ok).toBe(false);
				const off = await runScript(conn!, 'INSERT INTO chi VALUES (1, 99)', {
					db,
					foreignKeyChecks: false
				});
				expect(off.statements[0].ok).toBe(true);
			})
		);

		it(
			'profiles statements',
			live(async () => {
				const s = ok(
					(await runScript(conn!, 'SELECT COUNT(*) FROM big', { db, profiling: true }))
						.statements[0]
				);
				expect(s.profile).not.toBeNull();
				expect(s.profile!.length).toBeGreaterThan(0);
				expect(Number(s.profile![0].duration)).toBeGreaterThanOrEqual(0);
			})
		);

		it(
			'runs EXPLAIN in front of a statement',
			live(async () => {
				const s = ok(
					(await runScript(conn!, 'SELECT * FROM big', { db, explain: 'traditional' }))
						.statements[0]
				);
				expect(s.kind).toBe('explain');
				expect(s.executedSql).toBe('EXPLAIN SELECT * FROM big');
				expect(s.resultSets[0].rows).toHaveLength(1);
				expect(s.pagination).toBeNull();
			})
		);

		it(
			'noSplit keeps a statement with semicolons whole',
			live(async () => {
				const s = ok(
					(await runScript(conn!, "SELECT 'a;b' AS x", { db, noSplit: true })).statements[0]
				);
				expect(s.resultSets[0].rows).toEqual([['a;b']]);
			})
		);

		it(
			'gives row keys only for single table results with a unique key',
			live(async () => {
				const rowKeys = createRowKeyResolver(dbi, SECRET);
				const withKey = ok(
					(await runScript(conn!, 'SELECT id, label FROM big WHERE id < 3', { db, rowKeys }))
						.statements[0]
				);
				const set = withKey.resultSets[0];
				expect(set.source).toEqual({ db, table: 'big' });
				expect(set.keys).toHaveLength(2);
				expect(verifyClause(SECRET, db, 'big', set.keys![0].where, set.keys![0].sig)).toBe(true);
				const [rows] = await conn!.query(
					`SELECT COUNT(*) AS c FROM \`${db}\`.big WHERE ${set.keys![1].where}`
				);
				expect(Number((rows as { c: unknown }[])[0].c)).toBe(1);

				for (const sql of [
					'SELECT label FROM big', // key column missing
					'SELECT * FROM nokey', // no unique key
					'SELECT id + 1 AS id FROM big' // expression
				]) {
					const r = ok((await runScript(conn!, sql, { db, rowKeys })).statements[0]);
					expect(r.resultSets[0].keys, sql).toBeNull();
				}
			})
		);
	});
}
