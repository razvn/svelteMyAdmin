import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { buildWhereBody, type Criterion } from '#lib/sql/table-search.ts';
import { loadSearchColumns, toCriterion } from './search.ts';
import { previewReplace, runReplace } from './find-replace.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`table search against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		let isMariaDB = false;
		const fixture = 'sma_test';
		const scratch = `tmp_t4e_int_${port}`;

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
				isMariaDB = (await dbi.getServerInfo()).serverType === 'MariaDB';
				await conn.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
				await conn.query(`CREATE DATABASE \`${scratch}\` DEFAULT CHARACTER SET utf8mb4`);
				await conn.query(
					`CREATE TABLE \`${scratch}\`.\`t\` (id int PRIMARY KEY, s varchar(50), n int, e enum('a','b'))`
				);
				await conn.query(
					`INSERT INTO \`${scratch}\`.\`t\` VALUES (1,'foo bar',1,'a'),(2,'Foo bar',2,'b'),(3,'foofoo',3,NULL),(4,'50%_off',4,'a'),(5,NULL,NULL,NULL)`
				);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});

		afterAll(async () => {
			if (conn) {
				await conn.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
				await conn.end();
			}
		});

		/** Search a table like the form does and return the ids matching. */
		async function ids(
			db: string,
			table: string,
			rows: {
				col: string;
				op: string;
				value?: string | string[];
				value2?: string;
				geom?: string;
			}[],
			idCol = 'id'
		): Promise<number[]> {
			const columns = await loadSearchColumns(dbi, db, table, 100);
			const criteria: Criterion[] = [];
			for (const r of rows) {
				const column = columns.find((c) => c.name === r.col)!;
				const values = Array.isArray(r.value) ? r.value : [r.value ?? ''];
				const c = toCriterion(column, {
					operator: r.op,
					values,
					value2: r.value2,
					geomFunc: r.geom
				});
				expect(c, `${r.col} ${r.op} accepted`).not.toBeNull();
				criteria.push(c!);
			}
			const where = buildWhereBody(criteria, '', { isMariaDB });
			const [res] = await conn!.query<RowDataPacket[]>(
				`SELECT ${idCol} FROM ${escapeQualified(db, table)}` +
					(where ? ` WHERE ${where}` : '') +
					` ORDER BY ${idCol}`
			);
			return res.map((r) => Number(r[idCol]));
		}

		it('searches sma_test.books by operator', async (ctx) => {
			if (!conn) return ctx.skip();
			const t = (rows: Parameters<typeof ids>[2]) => ids(fixture, 'books', rows);
			expect(await t([{ col: 'title', op: 'LIKE %...%', value: 'the' }])).toEqual([1, 2]);
			expect(await t([{ col: 'title', op: '=', value: 'Solaris' }])).toEqual([3]);
			expect(await t([{ col: 'title', op: 'REGEXP ^...$', value: 'Sol.*s' }])).toEqual([3]);
			expect(await t([{ col: 'price', op: '>=', value: '9.99' }])).toEqual([1, 2]);
			expect(await t([{ col: 'price', op: 'BETWEEN', value: '8', value2: '10' }])).toEqual([1, 3]);
			expect(await t([{ col: 'id', op: 'IN (...)', value: '1, 4' }])).toEqual([1, 4]);
			expect(await t([{ col: 'published_at', op: 'IS NULL' }])).toEqual([4]);
			expect(await t([{ col: 'status', op: '=', value: ['draft', 'archived'] }])).toEqual([3, 4]);
			expect(await t([{ col: 'status', op: '!=', value: 'published' }])).toEqual([3, 4]);
			expect(await t([{ col: 'author_id', op: '=', value: '2' }])).toEqual([3, 4]);
			expect(
				await t([
					{ col: 'author_id', op: '=', value: '1' },
					{ col: 'price', op: '<', value: '12' }
				])
			).toEqual([1]);
		});

		it('works on the scratch table: NULL, empty string, quotes, LIKE wildcards', async (ctx) => {
			if (!conn) return ctx.skip();
			const t = (rows: Parameters<typeof ids>[2]) => ids(scratch, 't', rows);
			expect(await t([{ col: 's', op: 'IS NULL' }])).toEqual([5]);
			expect(await t([{ col: 's', op: 'IS NOT NULL' }])).toEqual([1, 2, 3, 4]);
			expect(await t([{ col: 's', op: 'NOT LIKE %...%', value: 'foo' }])).toEqual([4]);
			expect(await t([{ col: 's', op: 'IN (...)', value: 'foo bar,,zzz' }])).toEqual([1, 2, 5]);
			expect(await t([{ col: 's', op: 'IN (...)', value: "x'y,50%_off" }])).toEqual([4]);
			expect(await t([{ col: 'n', op: 'NOT BETWEEN', value: '2', value2: '3' }])).toEqual([1, 4]);
			expect(await t([{ col: 'e', op: '=', value: ['a', 'b'] }])).toEqual([1, 2, 4]);
			// Quoted, so it is a (numerically coerced) value, never SQL: only n = 1 matches.
			expect(await t([{ col: 'n', op: '=', value: '1 OR 1=1' }])).toEqual([1]);
		});

		it('rejects operators not offered for the column', async (ctx) => {
			if (!conn) return ctx.skip();
			const columns = await loadSearchColumns(dbi, scratch, 't', 100);
			const e = columns.find((c) => c.name === 'e')!;
			expect(toCriterion(e, { operator: 'LIKE', values: ['a'] })).toBeNull();
			expect(toCriterion(e, { operator: '= 1 OR 1=1', values: ['a'] })).toBeNull();
		});

		it('offers a dropdown for a foreign key to a small table', async (ctx) => {
			if (!conn) return ctx.skip();
			const columns = await loadSearchColumns(dbi, fixture, 'books', 100);
			const author = columns.find((c) => c.name === 'author_id')!;
			expect(author.foreign?.map((o) => o.value)).toEqual(['1', '2', '3']);
			expect(author.foreign?.[0].label).toContain('Le Guin');
			expect(
				(await loadSearchColumns(dbi, fixture, 'books', 1)).find((c) => c.name === 'author_id')
					?.foreign
			).toBeNull();
			const status = columns.find((c) => c.name === 'status')!;
			expect(status.enumValues).toEqual(['draft', 'published', 'archived']);
		});

		it('geometry functions run on type_zoo', async (ctx) => {
			if (!conn) return ctx.skip();
			expect(
				await ids(fixture, 'type_zoo', [{ col: 'c_point', op: '=', value: '', geom: 'ST_IsEmpty' }])
			).not.toContain(1);
			expect(
				await ids(fixture, 'type_zoo', [
					{ col: 'c_point', op: '=', value: 'POINT(3 4)', geom: 'ST_Equals' }
				])
			).toEqual([1]);
			expect(
				await ids(fixture, 'type_zoo', [{ col: 'c_point', op: '>', value: '2', geom: 'ST_X' }])
			).toEqual([1]);
		});

		describe('find and replace', () => {
			const run = (input: Partial<Parameters<typeof runReplace>[3]> & { find: string }) => ({
				column: 's',
				replaceWith: '',
				useRegex: false,
				...input
			});

			it('previews and replaces case sensitively, treating % and _ literally', async (ctx) => {
				if (!conn) return ctx.skip();
				const p = await previewReplace(dbi, scratch, 't', run({ find: 'foo', replaceWith: 'X' }));
				expect(p.rows).toBe(2);
				expect(p.samples.map((s) => [s.original, s.replaced])).toEqual([
					['foo bar', 'X bar'],
					['foofoo', 'XX']
				]);
				expect((await previewReplace(dbi, scratch, 't', run({ find: '%x' }))).rows).toBe(0);
				const r = await runReplace(dbi, scratch, 't', run({ find: '50%_', replaceWith: '100 ' }));
				expect(r.affected).toBe(1);
				const [rows] = await conn!.query<RowDataPacket[]>(
					`SELECT s FROM \`${scratch}\`.t WHERE id = 4`
				);
				expect(rows[0].s).toBe('100 off');
				const r2 = await runReplace(dbi, scratch, 't', run({ find: 'foo', replaceWith: 'X' }));
				expect(r2.affected).toBe(2);
				const [after] = await conn!.query<RowDataPacket[]>(
					`SELECT id, s FROM \`${scratch}\`.t ORDER BY id`
				);
				expect(after.map((x) => x.s)).toEqual(['X bar', 'Foo bar', 'XX', '100 off', null]);
			});

			it('replaces with a regular expression (case sensitive)', async (ctx) => {
				if (!conn) return ctx.skip();
				await conn.query(`UPDATE \`${scratch}\`.t SET s = 'abc ABC 123' WHERE id = 5`);
				const find = '[a-c]+';
				const p = await previewReplace(
					dbi,
					scratch,
					't',
					run({ find, replaceWith: '#', useRegex: true })
				);
				const row = p.samples.find((s) => s.original === 'abc ABC 123');
				expect(row?.replaced).toBe('# ABC 123');
				const r = await runReplace(
					dbi,
					scratch,
					't',
					run({ find, replaceWith: '#', useRegex: true })
				);
				expect(r.affected).toBeGreaterThanOrEqual(1);
				const [rows] = await conn.query<RowDataPacket[]>(
					`SELECT s FROM \`${scratch}\`.t WHERE id = 5`
				);
				expect(rows[0].s).toBe('# ABC 123');
			});

			it('reports bad patterns and non-text columns as errors', async (ctx) => {
				if (!conn) return ctx.skip();
				await expect(
					previewReplace(dbi, scratch, 't', run({ find: '(', useRegex: true }))
				).rejects.toBeTruthy();
				await expect(
					previewReplace(dbi, scratch, 't', run({ find: 'a', column: 'n' }))
				).rejects.toThrow(/text columns/);
			});
		});
	});
}
