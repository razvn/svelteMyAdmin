import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { deleteMatches, parseSearchRequest, searchTables } from './search.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

interface Query {
	s: string;
	t?: number;
	col?: string;
}

/** Run a search over every table of `db` (as the form does by default) and return the counts. */
async function counts(
	dbi: DatabaseInterface,
	db: string,
	q: Query
): Promise<Record<string, number>> {
	const tables = await dbi.listTables(db);
	const params = new URLSearchParams({
		criteriaSearchString: q.s,
		criteriaSearchType: String(q.t ?? 1),
		criteriaColumnName: q.col ?? '',
		submit_search: 'Go'
	});
	for (const t of tables) params.append('criteriaTables', t.name);
	const rows = await searchTables(dbi, db, tables, parseSearchRequest(params));
	return Object.fromEntries(rows.map((r) => [r.table, r.count]));
}

for (const { name, port } of servers) {
	describe(`database/search against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		// Read-only fixture.
		const fixture = 'sma_test';
		// Writable scratch database, dropped afterwards.
		const scratch = `sma_t3e_int_${port}`;

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
				await conn.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});

		afterAll(async () => {
			await conn?.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
			await conn?.end();
		});

		it('substring search finds an author and counts the view rows that join to them', async ({
			skip
		}) => {
			if (!conn) return skip();
			expect(await counts(dbi, fixture, { s: 'Guin', t: 3 })).toMatchObject({
				authors: 1,
				books: 0,
				v_book_authors: 2
			});
		});

		it('restricting to a column changes the result (bio does not contain the name)', async ({
			skip
		}) => {
			if (!conn) return skip();
			expect(await counts(dbi, fixture, { s: 'Ursula', t: 3 })).toMatchObject({ authors: 1 });
			expect(await counts(dbi, fixture, { s: 'Ursula', t: 3, col: 'bio' })).toMatchObject({
				authors: 0
			});
		});

		it('all of the words: every word must match somewhere in the row', async ({ skip }) => {
			if (!conn) return skip();
			expect(await counts(dbi, fixture, { s: 'The Dispossessed', t: 2 })).toMatchObject({
				books: 1,
				authors: 0
			});
		});

		it('at least one of the words: any word is enough', async ({ skip }) => {
			if (!conn) return skip();
			// Solaris (title) and "Draft" (title + status enum 'draft', case-insensitive collation)
			expect(await counts(dbi, fixture, { s: 'Solaris Draft', t: 1 })).toMatchObject({
				books: 2
			});
		});

		it('whole field: exact value, and % stays a wildcard', async ({ skip }) => {
			if (!conn) return skip();
			expect(await counts(dbi, fixture, { s: 'Solaris', t: 4 })).toMatchObject({ books: 1 });
			// The fixture's non-ASCII text is double-encoded on MySQL, so only ASCII is asserted here.
			expect(await counts(dbi, fixture, { s: 'Stan%Lem', t: 4 })).toMatchObject({ authors: 1 });
			expect(await counts(dbi, fixture, { s: 'Solar', t: 4 })).toMatchObject({ books: 0 });
		});

		it('regular expression', async ({ skip }) => {
			if (!conn) return skip();
			expect(await counts(dbi, fixture, { s: '^Stan', t: 5 })).toMatchObject({ authors: 1 });
		});

		it('values with quotes, double quotes and backslashes are matched literally', async ({
			skip
		}) => {
			if (!conn) return skip();
			expect(await counts(dbi, fixture, { s: "O'Brien", t: 3 })).toMatchObject({ authors: 1 });
			expect(await counts(dbi, fixture, { s: '"Quoted"', t: 3 })).toMatchObject({ authors: 1 });
			expect(await counts(dbi, fixture, { s: 'Name', t: 4 })).toMatchObject({ authors: 0 });
		});

		it('no match and unknown column give zero in every table', async ({ skip }) => {
			if (!conn) return skip();
			const none = await counts(dbi, fixture, { s: 'zz-no-such-value-zz', t: 3 });
			expect(Object.values(none).every((n) => n === 0)).toBe(true);
			const unknownColumn = await counts(dbi, fixture, { s: 'Guin', t: 3, col: 'no_such_column' });
			expect(Object.values(unknownColumn).every((n) => n === 0)).toBe(true);
		});

		describe('delete on a scratch database', () => {
			beforeAll(async () => {
				if (!conn) return;
				await conn.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
				await conn.query(`CREATE DATABASE \`${scratch}\``);
				await conn.query(
					`CREATE TABLE \`${scratch}\`.\`items\` (
						\`id\` int NOT NULL PRIMARY KEY,
						\`name\` varchar(50) NOT NULL,
						\`note\` varchar(50) NULL
					) ENGINE=InnoDB`
				);
				await conn.query(
					`INSERT INTO \`${scratch}\`.\`items\` (\`id\`, \`name\`, \`note\`) VALUES
						(1, 'apple', 'red'),
						(2, 'pear', 'apple pie'),
						(3, 'plum', 'blue'),
						(4, 'apple tart', 'x')`
				);
				await conn.query(
					`CREATE VIEW \`${scratch}\`.\`items_v\` AS SELECT * FROM \`${scratch}\`.\`items\``
				);
				await conn.query(
					`CREATE TABLE \`${scratch}\`.\`text_u\` (\`id\` int NOT NULL PRIMARY KEY, \`body\` varchar(100) NULL) ENGINE=InnoDB`
				);
				await conn.query(`INSERT INTO \`${scratch}\`.\`text_u\` (\`id\`, \`body\`) VALUES (?, ?)`, [
					1,
					'Stanisław Lem, café'
				]);
			});

			it('matches non-ASCII text round-tripped as utf8mb4', async ({ skip }) => {
				if (!conn) return skip();
				expect(await counts(dbi, scratch, { s: 'Stanisław', t: 3 })).toMatchObject({ text_u: 1 });
				expect(await counts(dbi, scratch, { s: 'café', t: 3 })).toMatchObject({ text_u: 1 });
			});

			it('deletes exactly the matching rows, honouring the column restriction', async ({
				skip
			}) => {
				if (!conn) return skip();
				const params = new URLSearchParams({
					criteriaSearchString: 'apple',
					criteriaSearchType: '3',
					criteriaColumnName: 'name',
					submit_search: 'Go',
					criteriaTables: 'items'
				});
				const req = parseSearchRequest(params);
				const tables = await dbi.listTables(scratch);

				const [before] = await searchTables(dbi, scratch, tables, req);
				expect(before).toMatchObject({ table: 'items', count: 2, isView: false });
				expect(before.deleteSql).toBe(
					'DELETE FROM `sma_t3e_int_' +
						port +
						"`.`items` WHERE (CONVERT(`name` USING utf8mb4) LIKE '%apple%')"
				);

				const res = await deleteMatches(dbi, scratch, tables, req, 'items');
				expect(res).toEqual({ ok: true, table: 'items', deleted: 2 });

				// 'apple' in the note of pear is untouched by the name-restricted delete
				const left = await counts(dbi, scratch, { s: 'apple', t: 3 });
				expect(left).toMatchObject({ items: 1, items_v: 1 });
			});

			it('refuses to delete from a view or from a table outside the search', async ({ skip }) => {
				if (!conn) return skip();
				const tables = await dbi.listTables(scratch);
				const view = parseSearchRequest(
					new URLSearchParams({
						criteriaSearchString: 'apple',
						criteriaSearchType: '3',
						submit_search: 'Go',
						criteriaTables: 'items_v'
					})
				);
				expect(await deleteMatches(dbi, scratch, tables, view, 'items_v')).toEqual({
					ok: false,
					error: 'Rows cannot be deleted from a view.'
				});

				const other = parseSearchRequest(
					new URLSearchParams({
						criteriaSearchString: 'apple',
						criteriaSearchType: '3',
						submit_search: 'Go',
						criteriaTables: 'items'
					})
				);
				expect(await deleteMatches(dbi, scratch, tables, other, 'items_v')).toEqual({
					ok: false,
					error: 'Table is not part of this search.'
				});
			});
		});
	});
}
