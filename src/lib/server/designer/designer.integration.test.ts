import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_OPTIONS } from '#lib/designer/export.ts';
import { createConnection, type Connection } from '../db/connection.ts';
import { DatabaseInterface } from '../db/dbi.ts';
import type { RelationServer } from '../table/relation.ts';
import { exportQuerySchema, exportSchema } from './export.ts';
import { createRelation, deleteRelation, setDisplayField } from './relations.ts';
import { loadDesignerSchema } from './schema.ts';
import {
	createPage,
	deletePage,
	listPages,
	loadPositions,
	loadSettings,
	pageExists,
	renamePage,
	savePositions,
	saveSetting,
	type DesignerTables
} from './storage.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`designer against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const db = `tmp_t9a_int_${port}`;
		const pma = `tmp_t9a_pma_${port}`;
		const t: DesignerTables = {
			pages: `\`${pma}\`.\`pma__pdf_pages\``,
			coords: `\`${pma}\`.\`pma__table_coords\``
		};
		const settings = `\`${pma}\`.\`pma__designer_settings\``;
		const server = {
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
			relation: 'pma__relation',
			table_info: 'pma__table_info'
		} as unknown as RelationServer;

		const dropAll = async () => {
			for (const d of [db, pma]) await conn!.query(`DROP DATABASE IF EXISTS \`${d}\``);
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
				await conn.query(`CREATE DATABASE \`${db}\` DEFAULT CHARACTER SET utf8mb4`);
				await conn.query(`CREATE DATABASE \`${pma}\``);
				await conn.query(
					`CREATE TABLE \`${db}\`.authors (id int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, name varchar(50) NOT NULL) ENGINE=InnoDB`
				);
				await conn.query(
					`CREATE TABLE \`${db}\`.books (id int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, author_id int unsigned NOT NULL, ` +
						'editor_id int unsigned NULL, title varchar(100), KEY (author_id)) ENGINE=InnoDB'
				);
				await conn.query(
					`CREATE TABLE \`${db}\`.notes (id int PRIMARY KEY, txt text) ENGINE=MyISAM`
				);
				const q = (sql: string) => conn!.query(sql);
				await q(
					`CREATE TABLE ${t.pages} (db_name varchar(64) NOT NULL default '', page_nr int(10) unsigned NOT NULL auto_increment, ` +
						"page_descr varchar(50) NOT NULL default '', PRIMARY KEY (page_nr), KEY db_name (db_name))"
				);
				await q(
					`CREATE TABLE ${t.coords} (db_name varchar(64) NOT NULL default '', table_name varchar(64) NOT NULL default '', ` +
						'pdf_page_number int(11) NOT NULL default 0, x float unsigned NOT NULL default 0, y float unsigned NOT NULL default 0, ' +
						'PRIMARY KEY (db_name, table_name, pdf_page_number))'
				);
				await q(
					`CREATE TABLE ${settings} (username varchar(64) NOT NULL, settings_data text NOT NULL, PRIMARY KEY (username))`
				);
				await q(
					`CREATE TABLE \`${pma}\`.pma__relation (master_db varchar(64) NOT NULL default '', master_table varchar(64) NOT NULL default '', ` +
						"master_field varchar(64) NOT NULL default '', foreign_db varchar(64) NOT NULL default '', foreign_table varchar(64) NOT NULL default '', " +
						"foreign_field varchar(64) NOT NULL default '', PRIMARY KEY (master_db, master_table, master_field))"
				);
				await q(
					`CREATE TABLE \`${pma}\`.pma__table_info (db_name varchar(64) NOT NULL default '', table_name varchar(64) NOT NULL default '', ` +
						"display_field varchar(64) NOT NULL default '', PRIMARY KEY (db_name, table_name))"
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

		it('creates, renames, saves coordinates of and deletes pages', async ({ skip }) => {
			if (!conn) return skip();
			const id = await createPage(conn, t, db, 'first');
			expect(await pageExists(conn, t, db, id)).toBe(true);
			expect(await pageExists(conn, t, 'other_db', id)).toBe(false);
			await savePositions(conn, t, db, id, {
				authors: { x: 10.5, y: 20 },
				books: { x: -5, y: 300 }
			});
			expect(await loadPositions(conn, t, db, id)).toEqual({
				authors: { x: 10.5, y: 20 },
				books: { x: 0, y: 300 }
			});
			// saving again replaces the rows of the page
			await savePositions(conn, t, db, id, { authors: { x: 1, y: 2 } });
			expect(await loadPositions(conn, t, db, id)).toEqual({ authors: { x: 1, y: 2 } });
			await renamePage(conn, t, db, id, 'renamed');
			expect(await listPages(conn, t, db)).toEqual([{ id, name: 'renamed' }]);
			await deletePage(conn, t, db, id);
			expect(await listPages(conn, t, db)).toEqual([]);
			expect(await loadPositions(conn, t, db, id)).toEqual({});
		});

		it('stores designer settings as phpMyAdmin compatible JSON', async ({ skip }) => {
			if (!conn) return skip();
			await saveSetting(conn, settings, 'alice', 'angular_direct', 'angular');
			await saveSetting(conn, settings, 'alice', 'snap_to_grid', 'on');
			const [rows] = await conn.query(
				`SELECT settings_data FROM ${settings} WHERE username = 'alice'`
			);
			expect(JSON.parse((rows as { settings_data: string }[])[0].settings_data)).toEqual({
				angular_direct: 'angular',
				snap_to_grid: 'on'
			});
			expect(await loadSettings(conn, settings, 'alice')).toEqual({
				angular_direct: 'angular',
				snap_to_grid: 'on'
			});
			expect(await loadSettings(conn, settings, 'nobody')).toEqual({});
		});

		it('creates and deletes foreign keys and internal relations, and the display field', async ({
			skip
		}) => {
			if (!conn) return skip();
			let res = await createRelation(dbi, server, db, {
				kind: 'fk',
				fromTable: 'books',
				fromColumn: 'author_id',
				toTable: 'authors',
				toColumn: 'id',
				onDelete: 'CASCADE',
				onUpdate: '',
				name: 'fk_books_authors'
			});
			expect(res.ok, JSON.stringify(res)).toBe(true);
			res = await createRelation(dbi, server, db, {
				kind: 'internal',
				fromTable: 'books',
				fromColumn: 'editor_id',
				toTable: 'authors',
				toColumn: 'id'
			});
			expect(res.ok, JSON.stringify(res)).toBe(true);
			res = await setDisplayField(dbi, server, db, { table: 'authors', column: 'name' });
			expect(res.ok).toBe(true);

			const schema = await loadDesignerSchema(dbi, server, db);
			expect(schema.tables.map((x) => x.name)).toEqual(['authors', 'books', 'notes']);
			expect(schema.tables.find((x) => x.name === 'authors')?.displayField).toBe('name');
			const books = schema.tables.find((x) => x.name === 'books')!;
			expect(books.columns.find((c) => c.name === 'id')?.primary).toBe(true);
			expect(books.columns.find((c) => c.name === 'author_id')).toMatchObject({
				foreign: true,
				indexed: true
			});
			expect(schema.relations.map((r) => [r.kind, r.fromColumn, r.toTable]).sort()).toEqual([
				['fk', 'author_id', 'authors'],
				['internal', 'editor_id', 'authors']
			]);
			const fk = schema.relations.find((r) => r.kind === 'fk')!;
			expect(fk).toMatchObject({ constraint: 'fk_books_authors', onDelete: 'CASCADE' });

			// a foreign key on a MyISAM table is refused
			res = await createRelation(dbi, server, db, {
				kind: 'fk',
				fromTable: 'notes',
				fromColumn: 'id',
				toTable: 'authors',
				toColumn: 'id'
			});
			expect(res.ok).toBe(false);

			res = await deleteRelation(dbi, server, db, {
				kind: 'fk',
				table: 'books',
				column: 'author_id',
				constraint: fk.constraint
			});
			expect(res.ok, JSON.stringify(res)).toBe(true);
			res = await deleteRelation(dbi, server, db, {
				kind: 'internal',
				table: 'books',
				column: 'editor_id'
			});
			expect(res.ok).toBe(true);
			expect((await loadDesignerSchema(dbi, server, db)).relations).toEqual([]);
		});

		it('exports SVG and PDF files with the table names', async ({ skip }) => {
			if (!conn) return skip();
			await createRelation(dbi, server, db, {
				kind: 'fk',
				fromTable: 'books',
				fromColumn: 'author_id',
				toTable: 'authors',
				toColumn: 'id'
			});
			const id = await createPage(conn, t, db, 'export');
			await savePositions(conn, t, db, id, { authors: { x: 400, y: 40 }, books: { x: 40, y: 40 } });
			const storage = { conn, tables: t };
			const svg = await exportSchema(
				dbi,
				server,
				db,
				exportQuerySchema.parse({ format: 'svg', page: String(id), show_grid: '1' }),
				storage
			);
			expect(svg.mimeType).toBe('image/svg+xml');
			const text = String(svg.body);
			expect(text).toContain('data-table="authors"');
			expect(text).toContain('data-table="books"');
			expect(text).not.toContain('data-table="notes"');
			expect(text).toContain('<polygon');

			const pdf = await exportSchema(
				dbi,
				server,
				db,
				exportQuerySchema.parse({ format: 'pdf', page: String(id), with_doc: '1', paper: 'A3' }),
				storage
			);
			expect(pdf.mimeType).toBe('application/pdf');
			const bytes = pdf.body as Buffer;
			expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
			expect(bytes.subarray(-8).toString()).toContain('%%EOF');
			expect(bytes.length).toBeGreaterThan(2000);
			// defaults are valid options
			expect(DEFAULT_EXPORT_OPTIONS.paper).toBe('A4');
		});
	});
}
