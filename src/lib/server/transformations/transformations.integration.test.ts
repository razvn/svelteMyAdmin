import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { escapeId } from '#lib/server/db/escape.ts';
import { fetchRows, loadTableMeta, toBrowseRows } from '#lib/server/table/browse.ts';
import { signClause } from '#lib/server/table/signed-clause.ts';
import { GET } from '../../../routes/(app)/db/[db]/table/[table]/transformation/wrapper/+server.ts';
import { transformBrowseRows } from './apply.ts';
import { loadMime, saveMime } from './column-info.ts';
import { applyInputTransforms, attachInputTransforms, toFormValues } from './input.ts';
import { parseSubmission } from '#lib/server/table/insert-edit.ts';
import { loadColumns } from '#lib/server/table/insert-edit.ts';
import { isProtected, type FormColumn } from '#lib/sql/insert-edit.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];
const SECRET = 'test-secret';
// 1x1 transparent PNG
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

for (const { name, port } of servers) {
	describe(`column transformations against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const db = `tmp_t8c_int_${port}`;
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
			only_db: '',
			hide_db: '',
			controlhost: '',
			controlport: 0,
			controluser: 'pma',
			controlpass: 'pmapass',
			pmadb: 'phpmyadmin',
			column_info: 'pma__column_info'
		};
		let locals: App.Locals;

		const cleanup = async () => {
			if (!conn) return;
			await conn.query('DELETE FROM `phpmyadmin`.`pma__column_info` WHERE db_name = ?', [db]);
			await conn.query(`DROP DATABASE IF EXISTS ${escapeId(db)}`);
		};

		beforeAll(async () => {
			try {
				conn = await createConnection(server, 'root', 'root');
				await conn.query('SELECT 1 FROM `phpmyadmin`.`pma__column_info` LIMIT 1');
				await cleanup();
				await conn.query(`CREATE DATABASE ${escapeId(db)}`);
				await conn.query(
					`CREATE TABLE ${escapeId(db)}.t (id INT PRIMARY KEY, created DATETIME, flag TINYINT, ip INT UNSIGNED, img BLOB, note TEXT)`
				);
				await conn.query(
					`INSERT INTO ${escapeId(db)}.t VALUES (1, '2024-05-03 10:20:30', 1, 2130706433, ?, 'hello world'), (2, NULL, 0, NULL, NULL, NULL)`,
					[PNG]
				);
				dbi = new DatabaseInterface(conn, server);
				locals = {
					server,
					config: { BrowseMIME: true, blowfish_secret: SECRET },
					dbi: Promise.resolve(dbi),
					db: Promise.resolve(conn)
				} as unknown as App.Locals;
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} or its pmadb unreachable, skipping`);
			}
		});
		afterAll(async () => {
			await cleanup();
			await conn?.end();
		});

		it('stores and loads the settings in phpMyAdmin format', async (ctx) => {
			if (!conn) return ctx.skip();
			expect(await loadMime(locals, db, 't')).toEqual(new Map());
			const ok = await saveMime(locals, db, 't', [
				{
					column: 'created',
					mimetype: 'text_plain',
					transformation: 'Output/Text_Plain_Dateformat.php',
					transformation_options: '',
					input_transformation: '',
					input_transformation_options: ''
				},
				{
					column: 'flag',
					mimetype: '',
					transformation: 'output/text_plain_bool2text.php',
					transformation_options: "'yes','no'",
					input_transformation: '',
					input_transformation_options: ''
				},
				{
					column: 'img',
					mimetype: 'image_png',
					transformation: 'output/image_png_inline.php',
					transformation_options: '40,40',
					input_transformation: '',
					input_transformation_options: ''
				},
				{
					column: 'ip',
					mimetype: '',
					transformation: 'text_plain_longtoipv4.php',
					transformation_options: '',
					input_transformation: 'input/text_plain_iptolong.php',
					input_transformation_options: ''
				},
				{
					column: 'note',
					mimetype: 'bogus',
					transformation: 'output/unknown.php',
					transformation_options: 'x',
					input_transformation: '',
					input_transformation_options: ''
				}
			]);
			expect(ok).toBe(true);
			const mime = (await loadMime(locals, db, 't'))!;
			expect([...mime.keys()].sort()).toEqual(['created', 'flag', 'img', 'ip']);
			expect(mime.get('created')).toMatchObject({
				mimetype: 'text_plain',
				transformation: 'output/text_plain_dateformat.php'
			});
			expect(mime.get('flag')?.transformation_options).toBe("'yes','no'");
			expect(mime.get('ip')?.input_transformation).toBe('input/text_plain_iptolong.php');
			// a row with nothing left to say is removed
			await saveMime(locals, db, 't', [
				{
					column: 'flag',
					mimetype: '',
					transformation: '',
					transformation_options: '',
					input_transformation: '',
					input_transformation_options: ''
				}
			]);
			expect((await loadMime(locals, db, 't'))!.has('flag')).toBe(false);
			// restore for the next tests
			await saveMime(locals, db, 't', [
				{
					column: 'flag',
					mimetype: '',
					transformation: 'output/text_plain_bool2text.php',
					transformation_options: "'yes','no'",
					input_transformation: '',
					input_transformation_options: ''
				}
			]);
		});

		it('renames carry the settings along', async (ctx) => {
			if (!conn) return ctx.skip();
			await saveMime(locals, db, 't', [
				{
					column: 'created_at',
					oldName: 'created',
					mimetype: 'text_plain',
					transformation: 'output/text_plain_dateformat.php',
					transformation_options: '',
					input_transformation: '',
					input_transformation_options: ''
				}
			]);
			const mime = (await loadMime(locals, db, 't'))!;
			expect(mime.has('created')).toBe(false);
			expect(mime.get('created_at')?.transformation).toBe('output/text_plain_dateformat.php');
			await saveMime(locals, db, 't', [
				{
					column: 'created',
					oldName: 'created_at',
					mimetype: 'text_plain',
					transformation: 'output/text_plain_dateformat.php',
					transformation_options: '',
					input_transformation: '',
					input_transformation_options: ''
				}
			]);
		});

		it('browse data carries the transformed values', async (ctx) => {
			if (!conn) return ctx.skip();
			const meta = await loadTableMeta(dbi, db, 't');
			const { rows } = await fetchRows(conn, `SELECT * FROM ${escapeId(db)}.t ORDER BY id`);
			const signed = toBrowseRows(SECRET, db, 't', meta.condCols, rows);
			const mime = (await loadMime(locals, db, 't'))!;
			const t = transformBrowseRows({
				db,
				table: 't',
				mime,
				targets: meta.columns.map((c) => ({ name: c.name, kind: c.kind, settingsName: c.name })),
				rows,
				signed
			});
			const idx = (n: string) => meta.columns.findIndex((c) => c.name === n);
			expect(t[idx('created')][0]).toMatchObject({
				type: 'text',
				text: 'May 03, 2024 at 10:20 AM'
			});
			expect(t[idx('created')][1]).toBeNull(); // NULL stays NULL
			expect(t[idx('flag')].map((x) => (x?.type === 'text' ? x.text : null))).toEqual([
				'yes',
				'no'
			]);
			expect(t[idx('ip')][0]).toMatchObject({ text: '127.0.0.1' });
			const img = t[idx('img')][0];
			expect(img).toMatchObject({ type: 'image', width: 40, height: 40 });
			if (img?.type !== 'image') throw new Error('not an image');
			expect(img.src).toContain(`/db/${db}/table/t/transformation/wrapper?`);
			expect(img.src).toContain('col=img');
			expect(t[idx('note')]).toBeUndefined();
		});

		it('the wrapper streams the blob with the right type', async (ctx) => {
			if (!conn) return ctx.skip();
			const where = '`id` = 1';
			const url = new URL('http://x/wrapper');
			url.searchParams.set('where', where);
			url.searchParams.set('sig', signClause(SECRET, db, 't', where));
			url.searchParams.set('col', 'img');
			const res = await GET({ params: { db, table: 't' }, url, locals } as never);
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(res.headers.get('content-disposition')).toMatch(/^inline/);
			expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);

			// a forged clause is refused
			const forged = new URL(url);
			forged.searchParams.set('where', '1=1');
			await expect(
				GET({ params: { db, table: 't' }, url: forged, locals } as never)
			).rejects.toMatchObject({ status: 400 });

			// text is a download, never inline
			const noteWhere = '`id` = 1';
			const text = new URL(url);
			text.searchParams.set('where', noteWhere);
			text.searchParams.set('sig', signClause(SECRET, db, 't', noteWhere));
			text.searchParams.set('col', 'note');
			text.searchParams.set('ct', 'text/html');
			const dl = await GET({ params: { db, table: 't' }, url: text, locals } as never);
			expect(dl.headers.get('content-type')).toBe('application/octet-stream');
			expect(dl.headers.get('content-disposition')).toMatch(/^attachment/);
		});

		it('input transformations convert on save', async (ctx) => {
			if (!conn) return ctx.skip();
			const columns: FormColumn[] = await attachInputTransforms(
				locals,
				db,
				't',
				(await loadColumns(conn, db, 't')).map((c) => ({
					...c,
					protected: isProtected(c, 'blob'),
					defaultFunction: '',
					foreign: null
				}))
			);
			const ip = columns.find((c) => c.name === 'ip')!;
			expect(ip.inputTransform?.id).toBe('text_plain_iptolong');

			const form = new FormData();
			form.set('rows', '1');
			columns.forEach((c, i) => form.set(`v_0_${i}`, c.name === 'ip' ? '10.0.0.1' : ''));
			const sub = await parseSubmission(form, columns);
			applyInputTransforms(sub, columns);
			expect(sub.rows[0].cells[columns.indexOf(ip)].cell.value).toBe('167772161');

			// the edit form shows the dotted quad
			const row = {
				cells: columns.map((c) => ({
					value: c.name === 'ip' ? '2130706433' : '',
					setValues: [],
					isNull: false,
					func: '',
					salt: '',
					prev: c.name === 'ip' ? '2130706433' : ''
				})),
				sizes: columns.map(() => null)
			};
			toFormValues(columns, [row]);
			expect(row.cells[columns.indexOf(ip)]).toMatchObject({
				value: '127.0.0.1',
				prev: '127.0.0.1'
			});
		});

		it('is off when BrowseMIME is disabled or the storage is not configured', async (ctx) => {
			if (!conn) return ctx.skip();
			const off = { ...locals, config: { ...locals.config, BrowseMIME: false } } as App.Locals;
			expect(await loadMime(off, db, 't')).toBeNull();
			const noStore = { ...locals, server: { ...server, pmadb: '' } } as unknown as App.Locals;
			expect(await loadMime(noStore, db, 't')).toBeNull();
			expect(await saveMime(off, db, 't', [])).toBe(false);
		});
	});
}
