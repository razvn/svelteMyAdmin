import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { DatabaseInterface } from '#lib/server/db/dbi.ts';
import {
	buildSelect,
	countRows,
	fetchRows,
	loadTableMeta,
	toBrowseRows
} from '#lib/server/table/browse.ts';
import { buildOrderBy } from '#lib/server/table/order-by.ts';
import { listForeignKeys } from '#lib/server/table/relations.ts';
import { deleteRows, updateCell } from '#lib/server/table/row-actions.ts';
import { verifyClause } from '#lib/server/table/signed-clause.ts';
import { isBinaryCell } from '#lib/components/results/format.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];
const SECRET = 'test-secret';

for (const { name, port } of servers) {
	describe(`table/browse against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const db = `tmp_t4a_int_${port}`;
		const locals = { server: { pmadb: '', relation: '' } } as unknown as App.Locals;

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

		/** Every browsed row's condition must select exactly its own row(s). */
		async function expectConditionsMatch(schema: string, table: string) {
			const meta = await loadTableMeta(dbi, schema, table);
			const sql = buildSelect({ db: schema, table, columns: meta.columns });
			const { rows } = await fetchRows(conn!, sql);
			const browsed = toBrowseRows(SECRET, schema, table, meta.condCols, rows);
			expect(browsed.length).toBeGreaterThan(0);
			for (const row of browsed) {
				const [res] = await conn!.query(
					`SELECT COUNT(*) AS c FROM \`${schema}\`.\`${table}\` WHERE ${row.where}`
				);
				expect(Number((res as { c: unknown }[])[0].c), row.where).toBeGreaterThanOrEqual(1);
				expect(verifyClause(SECRET, schema, table, row.where, row.sig)).toBe(true);
			}
			return { meta, browsed };
		}

		it(
			'browses type_zoo with every type',
			live(async () => {
				const { meta, browsed } = await expectConditionsMatch('sma_test', 'type_zoo');
				expect(meta.hasUniqueKey).toBe(true);
				const byName = (n: string) => meta.columns.findIndex((c) => c.name === n);
				const full = browsed[0].cells;
				expect(full[byName('c_binary')]).toMatchObject({ bytes: 8, preview: '0102030405060708' });
				expect(isBinaryCell(full[byName('c_blob')])).toBe(true);
				expect(full[byName('c_bit')]).toBe('10101010');
				expect(full[byName('c_geometry')]).toBe('POINT(1 2)');
				expect(full[byName('c_point')]).toBe('POINT(3 4)');
				expect(JSON.parse(full[byName('c_json')] as string)).toEqual({
					k: [1, 2, { n: null }],
					s: 'v'
				});
				expect(full[byName('c_bigint_u')]).toBe('18446744073709551615');
				expect(full[byName('c_datetime')]).toBe('2024-02-29 13:45:10.123');
				expect(full[byName('c_time')]).toBe('-12:34:56');
				expect(full[byName('c_float')]).toBe('1.5');
				expect(full[byName('c_enum')]).toBe('large');
				expect(full[byName('c_varchar')]).toBe('varchar éè');
				// second row: NULLs (and the default 'medium' / 0)
				const sparse = browsed[1].cells;
				expect(sparse[byName('c_blob')]).toBeNull();
				expect(sparse[byName('c_enum')]).toBe('medium');
			})
		);

		it(
			'identifies rows of a table without any key through all columns',
			live(async () => {
				await conn!.query(
					`CREATE TABLE \`${db}\`.\`nokey\` (a int, f double, b varbinary(20), t varchar(20), bt bit(4), d decimal(5,2), g point NULL)`
				);
				await conn!.query(
					`INSERT INTO \`${db}\`.\`nokey\` VALUES (1, 0.1, 0x41255F, 'it''s \\\\ "q"', b'1010', 1.50, ST_GeomFromText('POINT(1 1)')), (NULL, 1e20, NULL, NULL, NULL, NULL, NULL)`
				);
				const { meta } = await expectConditionsMatch(db, 'nokey');
				expect(meta.hasUniqueKey).toBe(false);
			})
		);

		it(
			'detects the authors/books foreign key',
			live(async () => {
				const fks = await listForeignKeys(dbi, locals, 'sma_test', 'books');
				expect(fks).toEqual([
					{ column: 'author_id', refDb: 'sma_test', refTable: 'authors', refColumn: 'id' }
				]);
				expect(await listForeignKeys(dbi, locals, 'sma_test', 'authors')).toEqual([]);
			})
		);

		it(
			'sorts, paginates and counts',
			live(async () => {
				const meta = await loadTableMeta(dbi, 'sma_test', 'books');
				const names = meta.columns.map((c) => c.name);
				const sql = buildSelect({
					db: 'sma_test',
					table: 'books',
					columns: meta.columns,
					orderBy: buildOrderBy([{ column: 'title', dir: 'desc' }], names),
					offset: 1,
					limit: 2
				});
				expect(sql).toBe('SELECT * FROM `sma_test`.`books` ORDER BY `title` DESC LIMIT 1, 2');
				const { rows } = await fetchRows(conn!, sql);
				expect(rows.map((r) => r[names.indexOf('title')])).toEqual([
					'The Left Hand of Darkness',
					'The Dispossessed'
				]);

				expect(
					await countRows(conn!, 'sma_test', 'books', { isView: false, maxExactCount: 50000 })
				).toEqual({
					total: 4,
					approx: false
				});
				expect(
					await countRows(conn!, 'sma_test', 'books', {
						where: "`status` = 'published'",
						isView: false,
						maxExactCount: 0
					})
				).toEqual({ total: 2, approx: false });
			})
		);

		it(
			'updates a cell and deletes a row by signed condition',
			live(async () => {
				await conn!.query(
					`CREATE TABLE \`${db}\`.\`items\` (id int PRIMARY KEY, name varchar(20) NULL, kind enum('a','b') NOT NULL DEFAULT 'a')`
				);
				await conn!.query(
					`INSERT INTO \`${db}\`.\`items\` VALUES (1, 'one', 'a'), (2, 'two', 'a')`
				);
				const meta = await loadTableMeta(dbi, db, 'items');
				const { rows } = await fetchRows(conn!, `SELECT * FROM \`${db}\`.\`items\` ORDER BY id`);
				const [r1, r2] = toBrowseRows(SECRET, db, 'items', meta.condCols, rows);

				const upd = await updateCell(conn!, db, 'items', meta, r1.where, 'name', "O'Brien; --");
				expect(upd).toMatchObject({ ok: true, cell: "O'Brien; --", keyChanged: false });
				const nul = await updateCell(conn!, db, 'items', meta, r1.where, 'name', null);
				expect(nul).toMatchObject({ ok: true, cell: null });
				const bad = await updateCell(conn!, db, 'items', meta, r1.where, 'kind', null);
				expect(bad.ok).toBe(false);
				const enumErr = await updateCell(conn!, db, 'items', meta, r1.where, 'kind', 'zzz');
				expect(enumErr.ok).toBe(false);
				const unknown = await updateCell(conn!, db, 'items', meta, r1.where, 'nope', 'x');
				expect(unknown.ok).toBe(false);
				const key = await updateCell(conn!, db, 'items', meta, r2.where, 'id', '20');
				expect(key).toMatchObject({ ok: true, keyChanged: true });

				const del = await deleteRows(conn!, db, 'items', [r1.where]);
				expect(del).toMatchObject({ ok: true, deleted: 1 });
				const [left] = await conn!.query(`SELECT id FROM \`${db}\`.\`items\``);
				expect((left as { id: number }[]).map((r) => r.id)).toEqual([20]);
			})
		);
	});
}
