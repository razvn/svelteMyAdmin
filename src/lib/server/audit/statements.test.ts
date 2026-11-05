import mysql from 'mysql2';
import type { Connection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { bareConnection, intercept, statementOf } from '#lib/server/db/intercept.ts';
import type { AuditBody } from './index.ts';
import { installAudit, isAuditedStatement, redactSecrets } from './statements.ts';

/** A connection that answers reads with rows, writes with a result header, and fails `BOOM`. */
function fakeConnection() {
	const ran: string[] = [];
	const run = async (sql: unknown) => {
		const text = typeof sql === 'string' ? sql : (sql as { sql: string }).sql;
		ran.push(text);
		if (text.includes('BOOM')) {
			throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
		}
		if (/^\s*(select|show)/i.test(text)) return [[{ a: 1 }], []];
		return [{ affectedRows: 2, insertId: 0 }, undefined];
	};
	const conn = {
		query: run,
		execute: run,
		format: (sql: string, values: mysql.SqlValue[]) => mysql.format(sql, values)
	} as unknown as Connection;
	return { conn, ran };
}

function audited(includeValues = false) {
	const { conn, ran } = fakeConnection();
	const events: AuditBody[] = [];
	installAudit(conn, { write: (e) => events.push(e) }, { includeValues });
	return { conn, ran, events };
}

describe('audit statement layer', () => {
	it('logs write statements with their outcome', async () => {
		const { conn, events } = audited();
		await conn.query('INSERT INTO shop.t (id) VALUES (1)');
		await conn.execute('UPDATE shop.t SET v = 2');
		await conn.query('CREATE TABLE shop.u (id INT)');
		expect(events).toEqual([
			{
				event: 'statement',
				db: null,
				sql: 'INSERT INTO shop.t (id) VALUES (1)',
				ok: true,
				affectedRows: 2
			},
			{ event: 'statement', db: null, sql: 'UPDATE shop.t SET v = 2', ok: true, affectedRows: 2 },
			{
				event: 'statement',
				db: null,
				sql: 'CREATE TABLE shop.u (id INT)',
				ok: true,
				affectedRows: 2
			}
		]);
	});

	it('logs failed writes with the MySQL error code and rethrows', async () => {
		const { conn, events } = audited();
		await expect(conn.query('INSERT INTO t VALUES (1) /* BOOM */')).rejects.toThrow('Duplicate');
		expect(events).toEqual([
			{
				event: 'statement',
				db: null,
				sql: 'INSERT INTO t VALUES (1) /* BOOM */',
				ok: false,
				errorCode: 'ER_DUP_ENTRY'
			}
		]);
		expect(JSON.stringify(events)).not.toContain('Duplicate entry');
	});

	it('ignores reads', async () => {
		const { conn, ran, events } = audited();
		await conn.query('SELECT * FROM t WHERE updated = 1');
		await conn.query('SHOW TABLES');
		await conn.execute('SELECT ?', [1]);
		expect(ran).toHaveLength(3);
		expect(events).toEqual([]);
	});

	it('follows USE for the db of later statements', async () => {
		const { conn, events } = audited();
		await conn.query('USE `shop`');
		await conn.query('DELETE FROM t');
		expect(events).toMatchObject([{ db: 'shop', sql: 'DELETE FROM t' }]);
	});

	it('leaves separately passed values out unless includeValues', async () => {
		const off = audited(false);
		await off.conn.query('INSERT INTO t (a, b) VALUES (?, ?)', [1, 'secret']);
		await off.conn.query({ sql: 'UPDATE t SET b = ?', values: ['secret'] });
		expect(off.events.map((e) => (e as { sql: string }).sql)).toEqual([
			'INSERT INTO t (a, b) VALUES (?, ?)',
			'UPDATE t SET b = ?'
		]);

		const on = audited(true);
		await on.conn.query('INSERT INTO t (a, b) VALUES (?, ?)', [1, "it's"]);
		expect(on.events).toMatchObject([{ sql: "INSERT INTO t (a, b) VALUES (1, 'it\\'s')" }]);
	});

	/**
	 * Change tracking is another layer that writes its own rows through `bareConnection`. Whichever
	 * is installed first, a user statement is audited once and the other layer's own queries never.
	 */
	for (const order of ['audit first', 'audit last'] as const) {
		it(`composes with a bookkeeping layer (${order})`, async () => {
			const { conn, ran } = fakeConnection();
			const events: AuditBody[] = [];
			const seenByOther: string[] = [];
			const other = () =>
				intercept(conn, async (next, args) => {
					const result = await next(...args);
					const sql = statementOf(args)!.sql;
					seenByOther.push(sql);
					await bareConnection(conn).query(`INSERT INTO pmadb.log VALUES ('${sql.length}')`);
					return result;
				});
			const audit = () =>
				installAudit(conn, { write: (e) => events.push(e) }, { includeValues: false });
			const undo = order === 'audit first' ? [audit(), other()] : [other(), audit()];

			await conn.query('DELETE FROM t');
			expect(events).toEqual([
				{ event: 'statement', db: null, sql: 'DELETE FROM t', ok: true, affectedRows: 2 }
			]);
			expect(seenByOther).toEqual(['DELETE FROM t']);
			expect(ran).toEqual(['DELETE FROM t', "INSERT INTO pmadb.log VALUES ('13')"]);

			for (const u of undo.reverse()) u();
			await conn.query('DELETE FROM t');
			expect(events).toHaveLength(1);
			expect(seenByOther).toHaveLength(1);
		});
	}
});

describe('administration statements', () => {
	it.each([
		"GRANT SELECT ON *.* TO 'a'@'%'",
		"REVOKE ALL ON *.* FROM 'a'@'%'",
		"/* c */ GRANT r TO 'a'@'%'",
		"CREATE USER 'a'@'%'",
		"DROP USER 'a'@'%'",
		"ALTER USER 'a'@'%' ACCOUNT LOCK",
		"RENAME USER 'a'@'%' TO 'b'@'%'",
		'CREATE ROLE r',
		"SET PASSWORD FOR 'a'@'%' = 'z'",
		'SET DEFAULT ROLE ALL TO a',
		'SET GLOBAL max_connections = 10',
		'SET @@GLOBAL.max_connections = 10',
		'CREATE PROCEDURE p() SELECT 1',
		'CREATE DEFINER=`root`@`%` PROCEDURE p() SELECT 1',
		'CREATE OR REPLACE FUNCTION f() RETURNS INT RETURN 1',
		'DROP PROCEDURE p',
		'CREATE EVENT e ON SCHEDULE EVERY 1 DAY DO DELETE FROM t',
		'CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW SET NEW.a = 1',
		'DROP TRIGGER tr',
		'CALL p()',
		'KILL 12',
		'FLUSH PRIVILEGES',
		"LOAD DATA LOCAL INFILE 'x' INTO TABLE t",
		"INSTALL PLUGIN p SONAME 'p.so'",
		'STOP REPLICA',
		'PURGE BINARY LOGS BEFORE NOW()'
	])('audits %s', (sql) => {
		expect(isAuditedStatement(sql)).toBe(true);
	});

	it.each(['SELECT 1', 'SHOW GRANTS', "SET NAMES 'utf8mb4'", 'SET @x = 1', 'EXPLAIN SELECT 1'])(
		'ignores %s',
		(sql) => {
			expect(isAuditedStatement(sql)).toBe(false);
		}
	);

	it.each([
		["CREATE USER 'a'@'%' IDENTIFIED BY 's3cret'", "CREATE USER 'a'@'%' IDENTIFIED BY '***'"],
		[
			"CREATE USER 'a'@'%' IDENTIFIED WITH caching_sha2_password BY 's3cret'",
			"CREATE USER 'a'@'%' IDENTIFIED WITH caching_sha2_password BY '***'"
		],
		[
			"CREATE USER 'a'@'%' IDENTIFIED WITH 'caching_sha2_password' BY 's3cret'",
			"CREATE USER 'a'@'%' IDENTIFIED WITH 'caching_sha2_password' BY '***'"
		],
		[
			"ALTER USER 'a'@'%' IDENTIFIED BY 'new' REPLACE 'old'",
			"ALTER USER 'a'@'%' IDENTIFIED BY '***' REPLACE '***'"
		],
		[
			"CREATE USER 'a'@'%' IDENTIFIED WITH mysql_native_password AS '*ABC'",
			"CREATE USER 'a'@'%' IDENTIFIED WITH mysql_native_password AS '***'"
		],
		["CREATE USER a IDENTIFIED BY PASSWORD '*ABC'", "CREATE USER a IDENTIFIED BY PASSWORD '***'"],
		[
			"CREATE USER a IDENTIFIED VIA ed25519 USING PASSWORD('s3cret')",
			"CREATE USER a IDENTIFIED VIA ed25519 USING PASSWORD('***')"
		],
		[
			"CREATE USER a IDENTIFIED VIA ed25519 USING 'hash'",
			"CREATE USER a IDENTIFIED VIA ed25519 USING '***'"
		],
		["SET PASSWORD FOR 'a'@'%' = 'it''s'", "SET PASSWORD FOR 'a'@'%' = '***'"],
		["SET PASSWORD FOR 'a'@'%' = PASSWORD('s3cret')", "SET PASSWORD FOR 'a'@'%' = PASSWORD('***')"],
		["SET PASSWORD = 'mine'", "SET PASSWORD = '***'"]
	])('redacts %s', (sql, expected) => {
		expect(redactSecrets(sql)).toBe(expected);
	});

	it('logs administration statements without their passwords, values included', async () => {
		const { conn, events } = audited(true);
		await conn.query("CREATE USER 'a'@'%' IDENTIFIED BY ?", ['s3cret']);
		await conn.query("GRANT SELECT ON shop.* TO 'a'@'%'");
		expect(events.map((e) => (e as { sql: string }).sql)).toEqual([
			"CREATE USER 'a'@'%' IDENTIFIED BY '***'",
			"GRANT SELECT ON shop.* TO 'a'@'%'"
		]);
		expect(JSON.stringify(events)).not.toContain('s3cret');
	});
});
