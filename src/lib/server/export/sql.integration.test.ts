import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '#lib/server/db/connection.ts';
import { splitStatements } from '#lib/server/db/splitter.ts';
import { connect, envFor, exportString, normalize, SERVERS } from './testing.ts';
import type { ExportEnv } from './run.ts';

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(here, 'golden');

function golden(name: string, actual: string) {
	const file = join(goldenDir, name);
	if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) {
		mkdirSync(goldenDir, { recursive: true });
		writeFileSync(file, actual);
	}
	expect(actual).toBe(readFileSync(file, 'utf8'));
}

for (const server of SERVERS) {
	describe(`SQL export against ${server.label}`, () => {
		let conn: Connection | undefined;
		let env: ExportEnv;
		const src = `tmp_t6a_src_${server.port}`;
		const dst = `tmp_t6a_dst_${server.port}`;

		beforeAll(async () => {
			conn = await connect(server.port);
			if (!conn) return;
			env = await envFor(conn, server.port);
			for (const db of [src, dst]) await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn.query(`CREATE DATABASE \`${src}\` DEFAULT CHARACTER SET utf8mb4`);
			const setup = readFileSync(join(here, 'fixtures', 'zoo.sql'), 'utf8');
			for (const st of splitStatements(setup)) {
				if (st.sql.trim()) await conn.query(st.sql.replaceAll('@DB@', `\`${src}\``));
			}
		});
		afterAll(async () => {
			if (!conn) return;
			for (const db of [src, dst]) await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn.end();
		});

		it('exports sma_test with the default options (golden)', async ({ skip }) => {
			if (!conn) return skip();
			const sql = await exportString(env, {
				scope: 'database',
				databases: ['sma_test'],
				structureOrData: 'structure_and_data'
			});
			golden(`sma_test.${server.name}.sql`, normalize(sql));
		});

		it('exports the type zoo database with every object kind (golden)', async ({ skip }) => {
			if (!conn) return skip();
			const sql = await exportString(env, {
				scope: 'database',
				databases: [src],
				structureOrData: 'structure_and_data'
			});
			golden(`zoo.${server.name}.sql`, normalize(sql).replaceAll(src, 'tmp_zoo'));
		});

		it('round-trips: export, import into another database, compare structure and checksums', async ({
			skip
		}) => {
			if (!conn) return skip();
			const sql = await exportString(env, {
				scope: 'database',
				databases: [src],
				structureOrData: 'structure_and_data',
				options: { drop_table: true }
			});
			await conn.query(`CREATE DATABASE \`${dst}\` DEFAULT CHARACTER SET utf8mb4`);
			await conn.query(`USE \`${dst}\``);
			await conn.query('SET NAMES utf8mb4');
			for (const st of splitStatements(sql)) {
				if (st.sql.trim()) await conn.query(st.sql);
			}
			const show = async (db: string, table: string) => {
				const [r] = await conn!.query(`SHOW CREATE TABLE \`${db}\`.\`${table}\``);
				const row = (r as Record<string, string>[])[0];
				return (row['Create Table'] ?? row['Create View'])
					.replace(/AUTO_INCREMENT=\d+ /, '')
					.replace(/DEFINER=`[^`]*`@`[^`]*` /, '');
			};
			const [tables] = await conn.query(
				'SELECT TABLE_NAME AS n, TABLE_TYPE AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY 1',
				[src]
			);
			expect((tables as { n: string }[]).length).toBe(4);
			for (const { n, t } of tables as { n: string; t: string }[]) {
				if (t === 'VIEW') {
					const [a] = await conn.query(`SELECT COUNT(*) AS c FROM \`${dst}\`.\`${n}\``);
					expect(a).toBeTruthy();
					continue;
				}
				expect(await show(dst, n), `structure of ${n}`).toBe(await show(src, n));
				const [a] = await conn.query(`CHECKSUM TABLE \`${src}\`.\`${n}\``);
				const [b] = await conn.query(`CHECKSUM TABLE \`${dst}\`.\`${n}\``);
				expect((b as { Checksum: string }[])[0].Checksum, `checksum of ${n}`).toBe(
					(a as { Checksum: string }[])[0].Checksum
				);
			}
			const [routines] = await conn.query(
				'SELECT COUNT(*) AS c FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?',
				[dst]
			);
			expect(Number((routines as { c: number }[])[0].c)).toBe(2);
			const [trg] = await conn.query(
				'SELECT COUNT(*) AS c FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
				[dst]
			);
			expect(Number((trg as { c: number }[])[0].c)).toBe(1);
			const [ev] = await conn.query(
				'SELECT COUNT(*) AS c FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?',
				[dst]
			);
			expect(Number((ev as { c: number }[])[0].c)).toBe(1);
		});
	});
}
