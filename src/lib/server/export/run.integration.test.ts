import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import type { Connection } from '#lib/server/db/connection.ts';
import { connect, defaultOptions, envFor, exportString, SERVERS } from './testing.ts';
import { exportToStream, exportToText, type ExportEnv } from './run.ts';
import { getExportPlugin } from './registry.ts';

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	for await (const c of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(c);
	return Buffer.concat(chunks);
}

for (const server of SERVERS) {
	describe(`export framework against ${server.label}`, () => {
		const db = `tmp_t6a_run_${server.port}`;
		let conn: Connection | undefined;
		let env: ExportEnv;

		beforeAll(async () => {
			conn = await connect(server.port);
			if (!conn) return;
			env = await envFor(conn, server.port);
			await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn.query(`CREATE DATABASE \`${db}\``);
			await conn.query(
				`CREATE TABLE \`${db}\`.\`t\` (id int NOT NULL PRIMARY KEY, name varchar(20), g int AS (id * 2) VIRTUAL)`
			);
			await conn.query(`INSERT INTO \`${db}\`.\`t\` (id, name) VALUES (1,'a'),(2,NULL),(3,'c')`);
			await conn.query(`CREATE VIEW \`${db}\`.\`v\` AS SELECT id, name FROM \`${db}\`.\`t\``);
		});
		afterAll(async () => {
			if (!conn) return;
			await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn.end();
		});

		const base = () => ({
			scope: 'database' as const,
			databases: [db],
			structureOrData: 'structure_and_data' as const
		});

		it('skips generated columns and exports views as stand-in then real view', async ({ skip }) => {
			if (!conn) return skip();
			const sql = await exportString(env, base());
			expect(sql).not.toContain('`g`,');
			expect(sql).toContain(
				"INSERT INTO `t` (`id`, `name`) VALUES\n(1, 'a'),\n(2, NULL),\n(3, 'c');"
			);
			expect(sql.indexOf('Stand-in structure for view `v`')).toBeLessThan(
				sql.indexOf('Structure for view `v`')
			);
		});

		it('honours INSERT variants', async ({ skip }) => {
			if (!conn) return skip();
			const get = (options: Record<string, string | boolean>) =>
				exportString(env, {
					...base(),
					tables: [{ name: 't', structure: false, data: true }],
					structureOrData: 'data',
					options
				});
			expect(await get({ ignore: true, insert_syntax: 'none' })).toContain(
				'INSERT IGNORE INTO `t` VALUES(2, NULL);'
			);
			expect(await get({ type: 'REPLACE', insert_syntax: 'complete' })).toContain(
				"REPLACE INTO `t` (`id`, `name`) VALUES(1, 'a');"
			);
			const upd = await get({ type: 'UPDATE' });
			expect(upd).toContain("UPDATE `t` SET `id` = 1,`name` = 'a' WHERE `id` = 1;");
			expect(upd).toContain('UPDATE `t` SET `id` = 2,`name` = NULL WHERE `id` = 2;');
			expect(await get({ truncate: true })).toContain('TRUNCATE TABLE `t`;');
		});

		it('structure options: drop, if not exists, no backquotes, disable fk, no comments', async ({
			skip
		}) => {
			if (!conn) return skip();
			const sql = await exportString(env, {
				...base(),
				tables: [{ name: 't', structure: true, data: false }],
				structureOrData: 'structure',
				options: {
					drop_table: true,
					if_not_exists: true,
					disable_fk: true,
					include_comments: false,
					use_transaction: false
				}
			});
			expect(sql).toContain('SET FOREIGN_KEY_CHECKS=0;');
			expect(sql).toContain('DROP TABLE IF EXISTS `t`;');
			expect(sql).toContain('CREATE TABLE IF NOT EXISTS `t` (');
			expect(sql).toContain('PRIMARY KEY (`id`)');
			expect(sql).not.toContain('--');
			expect(sql).not.toContain('START TRANSACTION');
			expect(sql.trimEnd().endsWith('SET FOREIGN_KEY_CHECKS=1;')).toBe(false); // charset restore follows
			expect(sql).toContain('SET FOREIGN_KEY_CHECKS=1;');
		});

		it('database scope with CREATE DATABASE, and server scope', async ({ skip }) => {
			if (!conn) return skip();
			const sql = await exportString(env, {
				...base(),
				tables: [{ name: 't', structure: true, data: false }],
				structureOrData: 'structure',
				options: { create_database: true }
			});
			expect(sql).toMatch(
				new RegExp(
					'CREATE DATABASE IF NOT EXISTS `' +
						db +
						'` DEFAULT CHARACTER SET utf8mb4 COLLATE \\w+;\\nUSE `' +
						db +
						'`;'
				)
			);
			const srv = await exportString(env, {
				scope: 'server',
				databases: [db],
				structureOrData: 'data'
			});
			expect(srv).toContain('CREATE DATABASE IF NOT EXISTS `' + db + '`');
		});

		it('table scope: signed-style where clauses, limit and raw queries', async ({ skip }) => {
			if (!conn) return skip();
			const where = await exportString(env, {
				scope: 'table',
				databases: [db],
				table: 't',
				where: ['`t`.`id` = 3', '`t`.`id` = 1'],
				structureOrData: 'data'
			});
			expect(where).toContain("(1, 'a'),\n(3, 'c');");
			const limited = await exportString(env, {
				scope: 'table',
				databases: [db],
				table: 't',
				allRows: false,
				limitFrom: 1,
				limitTo: 1,
				structureOrData: 'data'
			});
			expect(limited).toContain('(2, NULL);');
			expect(limited).not.toContain("'a'");
			const raw = await exportString(env, {
				scope: 'raw',
				databases: [db],
				sqlQuery: 'SELECT id, name FROM t WHERE id > 1',
				structureOrData: 'data'
			});
			expect(raw).toContain("INSERT INTO `t` (`id`, `name`) VALUES\n(2, NULL),\n(3, 'c');");
		});

		it('a single view exports its CREATE VIEW only', async ({ skip }) => {
			if (!conn) return skip();
			const sql = await exportString(env, {
				scope: 'table',
				databases: [db],
				table: 'v',
				structureOrData: 'structure_and_data'
			});
			expect(sql).toContain('CREATE ALGORITHM=');
			expect(sql).toContain('VIEW `v`  AS SELECT');
			expect(sql).not.toContain('DROP TABLE');
			expect(sql).toContain('Data: None');
		});

		it('rejects queries without a result set before any output', async ({ skip }) => {
			if (!conn) return skip();
			await expect(
				exportString(env, {
					scope: 'raw',
					databases: [db],
					sqlQuery: 'SELEC 1',
					structureOrData: 'data'
				})
			).rejects.toThrow();
		});

		it('streams gzip and zip, and the text view is capped', async ({ skip }) => {
			if (!conn) return skip();
			const plugin = getExportPlugin('sql')!;
			const req = { ...base(), plugin, options: defaultOptions('sql') };
			const gz = await collect(
				await exportToStream(env, req, {
					compression: 'gzip',
					charset: 'utf-8',
					zipEntryName: 'x.sql'
				})
			);
			expect(gunzipSync(gz).toString()).toContain('CREATE TABLE `t`');
			const zip = await collect(
				await exportToStream(env, req, {
					compression: 'zip',
					charset: 'utf-8',
					zipEntryName: 'x.sql'
				})
			);
			expect(Buffer.from(unzipSync(new Uint8Array(zip))['x.sql']).toString()).toContain(
				'CREATE TABLE `t`'
			);
			const text = await exportToText(env, req, 500);
			expect(text.truncated).toBe(true);
			expect(text.text).toHaveLength(500);
			expect(text.text).not.toContain('SET NAMES'); // no charset block when viewing
		});

		it('streams a big table in bounded memory and converts the charset', async ({ skip }) => {
			if (!conn) return skip();
			await conn.query(
				`CREATE TABLE \`${db}\`.\`big\` (id int NOT NULL PRIMARY KEY, s varchar(40))`
			);
			const values = Array.from({ length: 20000 }, (_, i) => `(${i + 1}, 'é${i + 1}')`);
			await conn.query(`INSERT INTO \`${db}\`.\`big\` VALUES ${values.join(',')}`);
			const plugin = getExportPlugin('sql')!;
			const req = {
				scope: 'table' as const,
				databases: [db],
				table: 'big',
				plugin,
				options: defaultOptions('sql'),
				structureOrData: 'data' as const
			};
			const out = await collect(
				await exportToStream(env, req, {
					compression: 'none',
					charset: 'iso-8859-1',
					zipEntryName: 'x'
				})
			);
			// latin1: é is the single byte 0xE9, and the dump declares the charset
			expect(out.includes(Buffer.from([0x27, 0xe9, 0x31, 0x27]))).toBe(true);
			expect(out.toString('latin1')).toContain('SET NAMES latin1');
			expect((out.toString('latin1').match(/INSERT INTO/g) ?? []).length).toBeGreaterThan(5); // max_query_size splits
		});
	});
}
