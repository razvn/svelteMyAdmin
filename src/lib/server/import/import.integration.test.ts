import { gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
	ImportOptionValues,
	ImportRequestOptions,
	ImportResult,
	ImportScope
} from '#lib/import/types.ts';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { runImport } from './execute.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

async function* bytes(data: Uint8Array | string, size = 997): AsyncGenerator<Uint8Array> {
	const u = typeof data === 'string' ? strToU8(data) : data;
	for (let i = 0; i < u.length; i += size) yield u.subarray(i, i + size);
}

for (const { name, port } of servers) {
	describe(`import against ${name}`, () => {
		let conn: Connection | undefined;
		const db = `tmp_t6d_int_${port}`;
		const extraDbs = [`tmp_t6d_csvdb_${port}`, `tmp_t6d_xml_${port}`];

		const run = async (
			scope: ImportScope,
			fileName: string,
			data: Uint8Array | string,
			req: Partial<ImportRequestOptions> & { options?: ImportOptionValues } = {},
			extra: { timeBudgetMs?: number; chunk?: number } = {}
		): Promise<ImportResult> =>
			runImport({
				conn: conn!,
				scope,
				body: bytes(data, extra.chunk),
				fileName,
				request: {
					format: 'auto',
					charset: 'utf-8',
					allowInterrupt: true,
					skipQueries: 0,
					fkChecks: true,
					options: {},
					...req
				},
				timeBudgetMs: extra.timeBudgetMs
			});
		const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
			((await conn!.query(sql, params))[0] as unknown as T[]) ?? [];
		const dbScope: ImportScope = { level: 'db', db };

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
				for (const d of [db, ...extraDbs]) await conn.query(`DROP DATABASE IF EXISTS \`${d}\``);
				await conn.query(`CREATE DATABASE \`${db}\``);
			} catch {
				conn = undefined;
			}
		});

		afterAll(async () => {
			if (!conn) return;
			for (const d of [db, ...extraDbs]) await conn.query(`DROP DATABASE IF EXISTS \`${d}\``);
			await conn.end();
		});

		const guard = (fn: () => Promise<void>) => async () => {
			if (!conn) return; // database not reachable: skip gracefully
			await fn();
		};

		it(
			'SQL: multi-statement file with DELIMITER, procedure and trigger, in odd chunks',
			guard(async () => {
				const sql = `-- dump
CREATE TABLE sales (id INT AUTO_INCREMENT PRIMARY KEY, amount INT NOT NULL, note VARCHAR(40));
CREATE TABLE audit (n INT);
INSERT INTO sales (amount, note) VALUES (10, 'semi;colon'), (20, "it's -- not a comment");
DELIMITER $$
CREATE TRIGGER sales_ai AFTER INSERT ON sales FOR EACH ROW
BEGIN
  INSERT INTO audit VALUES (NEW.amount);
  INSERT INTO audit VALUES (NEW.amount * 2);
END$$
CREATE PROCEDURE add_sale(IN a INT)
BEGIN
  INSERT INTO sales (amount) VALUES (a);
END$$
DELIMITER ;
CALL add_sale(5);
SELECT COUNT(*) FROM sales;
/*!40101 SET @x = 1 */;
`;
				const r = await run(dbScope, 'dump.sql', sql, {}, { chunk: 13 });
				expect(r.error).toBeNull();
				expect(r.ok).toBe(true);
				expect(r.format).toBe('sql');
				expect(r.queries).toBe(8);
				expect(r.message).toBe(
					'Import has been successfully finished, 8 queries executed. (dump.sql)'
				);
				expect(r.structureChanged).toBe(true);
				expect(r.created).toEqual([{ db, tables: ['sales', 'audit'] }]);
				expect(await q('SELECT amount FROM sales ORDER BY id')).toHaveLength(3);
				// 2 rows inserted before the trigger existed, the call afterwards fires it
				expect(await q('SELECT n FROM audit ORDER BY n')).toEqual([{ n: 5 }, { n: 10 }]);
				const routines = await q<{ ROUTINE_NAME: string }>(
					'SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?',
					[db]
				);
				expect(routines.map((x) => x.ROUTINE_NAME)).toEqual(['add_sale']);
				await conn!.query(`DROP DATABASE \`${db}\``);
				await conn!.query(`CREATE DATABASE \`${db}\``);
			})
		);

		it(
			'SQL: gzip and zip inputs, detected by extension and by content',
			guard(async () => {
				const sql = 'CREATE TABLE z (a INT);\nINSERT INTO z VALUES (1),(2);\n';
				const gz = await run(dbScope, 'z.sql.gz', new Uint8Array(gzipSync(strToU8(sql))));
				expect(gz.error).toBeNull();
				expect(gz.compression).toBe('gzip');
				expect(gz.queries).toBe(2);
				await q('DROP TABLE z');
				const zip = await run(dbScope, 'z.zip', zipSync({ 'inner.sql': strToU8(sql) }), {
					format: 'sql'
				});
				expect(zip.error).toBeNull();
				expect(zip.compression).toBe('zip');
				expect(await q('SELECT a FROM z')).toHaveLength(2);
				await q('DROP TABLE z');
				const sniffed = await run(dbScope, 'renamed.sql', new Uint8Array(gzipSync(strToU8(sql))));
				expect(sniffed.compression).toBe('gzip');
				expect(sniffed.ok).toBe(true);
				await q('DROP TABLE z');
			})
		);

		it(
			'SQL: an error stops the import and reports the line and statement',
			guard(async () => {
				const sql = `CREATE TABLE e1 (a INT PRIMARY KEY);
INSERT INTO e1 VALUES (1);

INSERT INTO e1 VALUES (1);
INSERT INTO e1 VALUES (2);
`;
				const r = await run(dbScope, 'bad.sql', sql);
				expect(r.ok).toBe(false);
				expect(r.queries).toBe(2);
				expect(r.error).toMatchObject({ line: 4, statement: 'INSERT INTO e1 VALUES (1)' });
				expect(r.error!.errno).toBe(1062);
				expect(r.message).toMatch(/Duplicate entry/);
				expect(r.resumeSkip).toBe(3);
				expect(r.retrySkip).toBe(2);
				expect(await q('SELECT a FROM e1')).toEqual([{ a: 1 }]);
				// continue after the failed statement through the skip count
				const cont = await run(dbScope, 'bad.sql', sql, { skipQueries: r.resumeSkip! });
				expect(cont.ok).toBe(true);
				expect(cont.skipped).toBe(3);
				expect(cont.queries).toBe(1);
				expect(await q('SELECT a FROM e1 ORDER BY a')).toEqual([{ a: 1 }, { a: 2 }]);
				await q('DROP TABLE e1');
			})
		);

		it(
			'SQL: partial import skips N queries, and an interrupted import resumes where it stopped',
			guard(async () => {
				await q('CREATE TABLE p (n INT)');
				const total = 300;
				const sql = Array.from({ length: total }, (_, i) => `INSERT INTO p VALUES (${i});`).join(
					'\n'
				);
				const skipped = await run(dbScope, 'p.sql', sql, { skipQueries: 290 });
				expect(skipped.ok).toBe(true);
				expect(skipped.queries).toBe(10);
				expect(await q('SELECT MIN(n) AS m, COUNT(*) AS c FROM p')).toEqual([{ m: 290, c: '10' }]);

				await q('TRUNCATE p');
				let skip = 0;
				let rounds = 0;
				for (;;) {
					const r = await run(dbScope, 'p.sql', sql, { skipQueries: skip }, { timeBudgetMs: 1 });
					rounds++;
					if (r.finished) break;
					expect(r.interrupted).toBe(true);
					expect(r.resumeSkip).toBeGreaterThan(skip);
					skip = r.resumeSkip!;
				}
				expect(rounds).toBeGreaterThan(1);
				expect(await q('SELECT COUNT(*) AS c, COUNT(DISTINCT n) AS d FROM p')).toEqual([
					{ c: String(total), d: String(total) }
				]);
				// without "allow interrupt" the time budget is ignored
				await q('TRUNCATE p');
				const full = await run(
					dbScope,
					'p.sql',
					sql,
					{ allowInterrupt: false },
					{ timeBudgetMs: 1 }
				);
				expect(full.finished).toBe(true);
				expect(full.queries).toBe(total);
				await q('DROP TABLE p');
			})
		);

		it(
			'SQL: SQL mode options and foreign key checks',
			guard(async () => {
				const r = await run(
					dbScope,
					'm.sql',
					'CREATE TABLE m (id INT AUTO_INCREMENT PRIMARY KEY, v INT);\nINSERT INTO m (id, v) VALUES (0, 7);\nCREATE TABLE c (id INT, FOREIGN KEY (id) REFERENCES m (id));\nINSERT INTO c VALUES (99);\n',
					{
						fkChecks: false,
						options: { compatibility: 'NONE', no_auto_value_on_zero: true }
					}
				);
				expect(r.error).toBeNull();
				expect(await q('SELECT id FROM m')).toEqual([{ id: 0 }]);
				await q('DROP TABLE c');
				await q('DROP TABLE m');
				await conn!.query('SET SESSION sql_mode = @@GLOBAL.sql_mode');
				const strict = await run(
					dbScope,
					'm.sql',
					'CREATE TABLE m2 (id INT PRIMARY KEY);\nCREATE TABLE c2 (id INT, FOREIGN KEY (id) REFERENCES m2 (id));\nINSERT INTO c2 VALUES (1);\n'
				);
				expect(strict.ok).toBe(false);
				expect(strict.error!.errno).toBe(1452);
				await q('DROP TABLE c2');
				await q('DROP TABLE m2');
			})
		);

		it(
			'CSV into an existing table: columns, header, replace/ignore/truncate, errors',
			guard(async () => {
				await q('CREATE TABLE people (id INT PRIMARY KEY, name VARCHAR(30), age INT NULL)');
				const tbl: ImportScope = { level: 'table', db, table: 'people' };
				const csv = 'id,name,age\n1,"Smith, Ann",30\n2,"Bob ""B""",NULL\n3,Cy,\n';
				const noHeader = await run(tbl, 'p.csv', csv.split('\n').slice(1).join('\n'), {
					options: { terminated: ',', enclosed: '"', escaped: '"', new_line: 'auto' }
				});
				expect(noHeader.error).toMatchObject({ line: 3 }); // age '' is not an INT
				expect(await q('SELECT id, name, age FROM people ORDER BY id')).toEqual([
					{ id: 1, name: 'Smith, Ann', age: 30 },
					{ id: 2, name: 'Bob "B"', age: null }
				]);
				expect(noHeader.resumeSkip).toBe(3);

				// header line + ignore: duplicates and bad rows do not abort
				const ign = await run(tbl, 'p.csv', csv, {
					options: { col_names: true, ignore: true }
				});
				expect(ign.ok).toBe(true);
				expect(ign.queries).toBe(3);
				expect(await q('SELECT COUNT(*) AS c FROM people')).toEqual([{ c: '3' }]);

				// replace = ON DUPLICATE KEY UPDATE
				const rep = await run(tbl, 'p.csv', '1,Renamed,31\n', { options: { replace: true } });
				expect(rep.ok).toBe(true);
				expect(await q('SELECT name FROM people WHERE id = 1')).toEqual([{ name: 'Renamed' }]);

				// truncate first, with an explicit column order
				const tr = await run(tbl, 'p.csv', '9,Zed\n8,Yan\n', {
					options: { truncate: true, columns: 'name, id' }
				});
				expect(tr.error?.message).toMatch(/Incorrect integer value|Data truncated/i);
				const tr2 = await run(tbl, 'p.csv', '9,Zed\n8,Yan\n', {
					options: { truncate: true, columns: 'id, name' }
				});
				expect(tr2.ok).toBe(true);
				expect(await q('SELECT id FROM people ORDER BY id')).toEqual([{ id: 8 }, { id: 9 }]);

				// separators, partial_import and a wrong column count
				const semi = await run(tbl, 'p.csv', '1;A;1\n2;B;2\n3;C;3\n', {
					options: { truncate: true, terminated: ';', partial_import: 2 }
				});
				expect(semi.ok).toBe(true);
				expect(semi.queries).toBe(2);
				const wrong = await run(tbl, 'p.csv', '10,A,1\n11,B\n', { options: {} });
				expect(wrong.error).toMatchObject({
					line: 2,
					message: 'Invalid column count in CSV input on line 2.'
				});
				const badCol = await run(tbl, 'p.csv', '1,2\n', { options: { columns: 'id,nope' } });
				expect(badCol.error?.message).toMatch(/Invalid column \(nope\)/);
				const badOpt = await run(tbl, 'p.csv', '1,2\n', { options: { terminated: '' } });
				expect(badOpt.error?.message).toMatch(/Columns terminated with/);
				const skip = await run(tbl, 'p.csv', '20,a,1\n21,b,2\n22,c,3\n', { skipQueries: 2 });
				expect(skip.queries).toBe(1);
				expect(await q('SELECT id FROM people WHERE id >= 20')).toEqual([{ id: 22 }]);
				await q('DROP TABLE people');
			})
		);

		it(
			'CSV at database level creates a table with guessed types',
			guard(async () => {
				const csv =
					'id,price,label,born,big\n1,1.5,abc,2020-01-02,9999999999\n22,10.25,abcdef,2021-12-31,1\n3,NULL,x,2000-01-01,2\n';
				const r = await run(dbScope, 'My Report.csv', csv, { options: { col_names: true } });
				expect(r.error).toBeNull();
				expect(r.created).toEqual([{ db, tables: ['my_report'] }]);
				expect(r.structureChanged).toBe(true);
				const cols = await q<{ n: string; t: string }>(
					'SELECT COLUMN_NAME AS n, COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
					[db, 'my_report']
				);
				expect(cols.map((c) => c.n)).toEqual(['id', 'price', 'label', 'born', 'big']);
				expect(cols.map((c) => c.t.replace(/^(int|bigint)\(\d+\)$/, '$1'))).toEqual([
					'int',
					'decimal(4,2)',
					'varchar(6)',
					'date',
					'bigint'
				]);
				expect(await q('SELECT price FROM my_report WHERE id = 3')).toEqual([{ price: null }]);
				// name taken: a numbered table, and generic COL names without a header line
				const again = await run(dbScope, 'my report.csv', 'a,b\n1,2\n');
				expect(again.created[0].tables).toEqual(['my_report_2']);
				const named = await run(dbScope, 'x.csv', 'a;b\n', {
					options: { terminated: ';', new_tbl_name: 'custom' }
				});
				expect(named.created[0].tables).toEqual(['custom']);
				expect(
					(
						await q<{ n: string }>(
							'SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
							[db, 'my_report_2']
						)
					).map((c) => c.n)
				).toEqual(['COL 1', 'COL 2']);
			})
		);

		it(
			'CSV at server level creates the database too',
			guard(async () => {
				const newDb = extraDbs[0];
				const r = await run({ level: 'server' }, 'data.csv', 'a,b\n1,x\n2,y\n', {
					options: { col_names: true, new_db_name: newDb }
				});
				expect(r.error).toBeNull();
				expect(r.created).toEqual([{ db: newDb, tables: ['data'] }]);
				expect(await q(`SELECT a, b FROM \`${newDb}\`.data ORDER BY a`)).toEqual([
					{ a: 1, b: 'x' },
					{ a: 2, b: 'y' }
				]);
			})
		);

		it(
			'ODS: sheets become tables',
			guard(async () => {
				const cell = (v: string) =>
					`<table:table-cell office:value-type="string"><text:p>${v}</text:p></table:table-cell>`;
				const content = `<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:table="t" xmlns:text="x"><office:body><office:spreadsheet>
<table:table table:name="Fruit"><table:table-row>${cell('name')}${cell('qty')}</table:table-row><table:table-row>${cell('apple')}${cell('3')}</table:table-row><table:table-row>${cell('pear')}${cell('12')}</table:table-row></table:table>
<table:table table:name="Other"><table:table-row>${cell('x')}</table:table-row><table:table-row>${cell('1.5')}</table:table-row></table:table>
</office:spreadsheet></office:body></office:document-content>`;
				const ods = zipSync({ mimetype: strToU8('x'), 'content.xml': strToU8(content) });
				const r = await run(dbScope, 'book.ods', ods, {
					options: { col_names: true, empty_rows: true }
				});
				expect(r.error).toBeNull();
				expect(r.created[0].tables).toEqual(['Fruit', 'Other']);
				expect(await q('SELECT name, qty FROM Fruit ORDER BY qty')).toEqual([
					{ name: 'apple', qty: 3 },
					{ name: 'pear', qty: 12 }
				]);
				const bad = await run(dbScope, 'broken.ods', strToU8('not a zip'));
				expect(bad.ok).toBe(false);
				expect(bad.message).toMatch(/OpenDocument/);
			})
		);

		it(
			'XML (phpMyAdmin export): structure + data into a new database, and into the current one',
			guard(async () => {
				const xmlDb = extraDbs[1];
				const xml = (dbName: string) => `<?xml version="1.0" encoding="utf-8"?>
<pma_xml_export version="1.0" xmlns:pma="https://www.phpmyadmin.net/some_doc_url/">
    <pma:structure_schemas>
        <pma:database name="${dbName}" collation="utf8mb4_general_ci" charset="utf8mb4">
            <pma:table name="items">
                CREATE TABLE \`items\` (
                  \`id\` int NOT NULL,
                  \`label\` varchar(20) DEFAULT NULL,
                  PRIMARY KEY (\`id\`)
                ) ENGINE=InnoDB;
            </pma:table>
        </pma:database>
    </pma:structure_schemas>
    <database name="${dbName}">
        <table name="items"><column name="id">1</column><column name="label">a &amp; b</column></table>
        <table name="items"><column name="id">2</column><column name="label">NULL</column></table>
    </database>
</pma_xml_export>`;
				const r = await run({ level: 'server' }, 'export.xml', xml(xmlDb));
				expect(r.error).toBeNull();
				expect(r.created).toEqual([{ db: xmlDb, tables: ['items'] }]);
				expect(await q(`SELECT id, label FROM \`${xmlDb}\`.items ORDER BY id`)).toEqual([
					{ id: 1, label: 'a & b' },
					{ id: 2, label: null }
				]);
				const into = await run(dbScope, 'export.xml', xml('whatever'));
				expect(into.error).toBeNull();
				expect(await q('SELECT COUNT(*) AS c FROM items')).toEqual([{ c: '2' }]);
				const noStruct = await run(
					dbScope,
					'data.xml',
					'<r><database name="x"><table name="plain"><column name="a">5</column></table></database></r>'
				);
				expect(noStruct.error).toBeNull();
				expect(await q('SELECT a FROM plain')).toEqual([{ a: 5 }]);
				const bad = await run(dbScope, 'bad.xml', '<a><b></a>');
				expect(bad.message).toMatch(/malformed or incomplete/);
			})
		);

		it(
			'MediaWiki tables',
			guard(async () => {
				const wiki = `<!--
Table data for \`wikit\`
-->

{| class="wikitable sortable" style="text-align:center;"
|+'''wikit'''
|-
 ! id
 ! title
|-
 | 1
 | Hello
|-
 | 2
 | World
|}
`;
				const r = await run(dbScope, 'wiki.txt', wiki, { format: 'mediawiki' });
				expect(r.error).toBeNull();
				expect(r.created[0].tables).toEqual(['wikit']);
				expect(await q('SELECT id, title FROM wikit ORDER BY id')).toEqual([
					{ id: 1, title: 'Hello' },
					{ id: 2, title: 'World' }
				]);
				const bad = await run(dbScope, 'w.txt', '{|\n|-\njunk line\n|}', { format: 'mediawiki' });
				expect(bad.ok).toBe(false);
				expect(bad.error!.line).toBe(3);
			})
		);

		it(
			'LOAD DATA is refused unless local_infile is on, and works when it is',
			guard(async () => {
				await q('CREATE TABLE ld (a INT, b VARCHAR(10))');
				const tbl: ImportScope = { level: 'table', db, table: 'ld' };
				const [flag] = await q<{ v: string }>('SELECT @@GLOBAL.local_infile AS v');
				const on = String(flag.v) === '1' || String(flag.v).toUpperCase() === 'ON';
				const r = await run(tbl, 'x.csv', '1;a\n2;b\n', { format: 'ldi', options: {} });
				if (!on) {
					expect(r.ok).toBe(false);
					expect(r.message).toMatch(/local_infile/);
				} else {
					expect(r.error).toBeNull();
					expect(await q('SELECT COUNT(*) AS c FROM ld')).toEqual([{ c: '2' }]);
				}
				const wrongLevel = await run(dbScope, 'x.csv', '1;a\n', { format: 'ldi' });
				expect(wrongLevel.ok).toBe(false);
				await q('DROP TABLE ld');
			})
		);

		it(
			'unknown format and unsupported compression give clear messages',
			guard(async () => {
				const unknown = await run(dbScope, 'mystery.bin', 'abc');
				expect(unknown.message).toMatch(/format could not be detected/);
				const bz = await run(dbScope, 'a.sql.bz2', 'BZh91AY');
				expect(bz.message).toMatch(/bzip2/);
			})
		);
	});
}
