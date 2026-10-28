import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { DatabaseInterface } from '#lib/server/db/dbi.ts';
import {
	deleteSearch,
	listSavedSearches,
	loadQuerySchema,
	saveSearch
} from '#lib/server/database/query-schema.ts';
import {
	buildMultiTableQuery,
	emptyMtqColumn,
	foreignKeysFromSchema
} from '#lib/sql/multi-table-query.ts';
import {
	buildQbeQuery,
	columnRef,
	emptyState,
	fromSearchData,
	schemaFromData,
	toSearchData
} from '#lib/sql/qbe.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`database/query-schema against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const pma = `tmp_t5d_pma_${port}`;
		const fixture = 'sma_test';
		// Only the fields the loaders read.
		const locals = (extra: Record<string, unknown> = {}) =>
			({
				server: { pmadb: '', relation: '', savedsearches: '', controluser: '', ...extra },
				session: { user: 'root' },
				get db() {
					return Promise.resolve(conn);
				}
			}) as unknown as App.Locals;

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
				await conn.query(`DROP DATABASE IF EXISTS \`${pma}\``);
				await conn.query(`CREATE DATABASE \`${pma}\``);
				await conn.query(
					`CREATE TABLE \`${pma}\`.\`pma__savedsearches\` (id int unsigned NOT NULL AUTO_INCREMENT, ` +
						`username varchar(64) NOT NULL DEFAULT '', db_name varchar(64) NOT NULL DEFAULT '', ` +
						`search_name varchar(64) NOT NULL DEFAULT '', search_data text NOT NULL, PRIMARY KEY (id), ` +
						`UNIQUE KEY u (username, db_name, search_name))`
				);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});

		afterAll(async () => {
			await conn?.query(`DROP DATABASE IF EXISTS \`${pma}\``);
			await conn?.end();
		});

		it('discovers the authors <-> books relation', async ({ skip }) => {
			if (!conn) return skip();
			const data = await loadQuerySchema(dbi, locals(), fixture);
			expect(data.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['authors', 'books']));
			expect(data.tables.find((t) => t.name === 'authors')!.columns).toEqual([
				'id',
				'name',
				'born',
				'bio'
			]);
			expect(data.foreignKeys).toContainEqual({
				constraint: 'fk_books_author',
				table: 'books',
				column: 'author_id',
				refTable: 'authors',
				refColumn: 'id'
			});
			expect(data.indexes).toContainEqual({ table: 'authors', column: 'id', nonUnique: false });
		});

		it('the generated QBE query runs and returns the expected rows', async ({ skip }) => {
			if (!conn) return skip();
			const schema = schemaFromData(await loadQuerySchema(dbi, locals(), fixture));
			const s = emptyState(3, 1);
			s.columns[0] = { ...s.columns[0], column: columnRef('authors', 'name'), show: true };
			s.columns[1] = {
				...s.columns[1],
				column: columnRef('books', 'title'),
				show: true,
				sort: 'ASC'
			};
			s.columns[2] = {
				...s.columns[2],
				column: columnRef('authors', 'name'),
				criteria: "= 'Stanisław Lem'"
			};
			const sql = buildQbeQuery(s, schema);
			expect(sql).toContain('LEFT JOIN `books` ON `books`.`author_id` = `authors`.`id`');
			await conn.query(`USE \`${fixture}\``);
			const [rows] = await conn.query(sql);
			expect((rows as Record<string, unknown>[]).map((r) => r.title)).toEqual([
				'Solaris',
				'Unpublished Draft'
			]);
		});

		it('OR rows run: either author', async ({ skip }) => {
			if (!conn) return skip();
			const schema = schemaFromData(await loadQuerySchema(dbi, locals(), fixture));
			const s = emptyState(2, 1);
			s.columns[0] = {
				...s.columns[0],
				column: columnRef('books', 'title'),
				show: true,
				criteria: "= 'Solaris'"
			};
			s.columns[1] = { ...s.columns[1], column: columnRef('authors', 'name'), show: true };
			s.rows[0].cells = ['', "= 'Ursula K. Le Guin'"];
			// WHERE (books.title = 'Solaris') OR (authors.name = ...)
			const sql = buildQbeQuery(s, schema);
			await conn.query(`USE \`${fixture}\``);
			const [rows] = await conn.query(sql);
			expect((rows as unknown[]).length).toBe(3);
		});

		it('the generated multi-table query runs', async ({ skip }) => {
			if (!conn) return skip();
			const keys = foreignKeysFromSchema(await loadQuerySchema(dbi, locals(), fixture));
			const r = buildMultiTableQuery(
				[
					{ ...emptyMtqColumn(), table: 'authors', column: 'name', columnAlias: 'author' },
					{
						...emptyMtqColumn(),
						table: 'books',
						column: 'title',
						useCriteria: true,
						criteriaColumn: 'price',
						op: '>',
						rhsText: '9',
						sort: 'DESC'
					}
				],
				keys
			);
			if (!r.ok) throw new Error(r.error);
			await conn.query(`USE \`${fixture}\``);
			const [rows] = await conn.query(r.sql);
			expect(rows).toEqual(
				[
					{ author: 'Ursula K. Le Guin', title: 'The Left Hand of Darkness' },
					{ author: 'Ursula K. Le Guin', title: 'The Dispossessed' }
				].sort((a, b) => b.title.localeCompare(a.title))
			);
		});

		it('saved searches: save, list, update, delete', async ({ skip }) => {
			if (!conn) return skip();
			const l = locals({ pmadb: pma, savedsearches: 'pma__savedsearches' });
			const s = emptyState(1, 1);
			s.columns[0].column = columnRef('books', 'id');
			const saved = await saveSearch(l, fixture, {
				name: 'mine',
				data: toSearchData(s, ['books'])
			});
			expect(saved.ok).toBe(true);
			const id = saved.ok ? saved.id : 0;
			const list = await listSavedSearches(l, fixture);
			expect(list).toHaveLength(1);
			expect(fromSearchData(list![0].data).state.columns[0].column).toBe('`books`.`id`');
			expect((await saveSearch(l, fixture, { name: 'mine', data: {} })).ok).toBe(false);
			expect((await saveSearch(l, fixture, { id, name: 'renamed', data: {} })).ok).toBe(true);
			expect((await listSavedSearches(l, fixture))![0].name).toBe('renamed');
			expect((await deleteSearch(l, fixture, id)).ok).toBe(true);
			expect(await listSavedSearches(l, fixture)).toEqual([]);
		});

		it('saved searches are unavailable without configuration storage', async ({ skip }) => {
			if (!conn) return skip();
			expect(await listSavedSearches(locals(), fixture)).toBeNull();
		});
	});
}
