import { afterAll } from 'vitest';
import { serverSchema } from '../../config/schema.ts';
import { createConnection, type Connection } from '../../db/connection.ts';
import { createMissingTables, createPmaDatabase } from '../../pmadb/features.ts';
import { PMA_FEATURES } from '../../pmadb/features.ts';
import { defineRepoContract } from '../contract.ts';
import { mysqlRepos } from '../index.ts';
import { connectionRunner } from './runner.ts';

// The same contract as SQLite, on a throw-away pmadb created from the verbatim create_tables.sql.
for (const { name, port } of [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
]) {
	const pmadb = `tmp_t11_int_${port}`;
	let conn: Connection | undefined;

	defineRepoContract(name, async () => {
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
			await conn.query(`DROP DATABASE IF EXISTS \`${pmadb}\``);
			await createPmaDatabase(conn, pmadb);
			const names = Object.fromEntries(PMA_FEATURES.map((f) => [f.key, f.table]));
			const server = serverSchema.parse({ pmadb, ...names });
			await createMissingTables(conn, pmadb, server);
			return { repos: mysqlRepos(server, connectionRunner(conn)) };
		} catch {
			console.warn(`[integration] ${name} unreachable, skipping`);
			await conn?.end().catch(() => {});
			conn = undefined;
			return null;
		}
	});

	afterAll(async () => {
		if (!conn) return;
		await conn.query(`DROP DATABASE IF EXISTS \`${pmadb}\``);
		await conn.end();
	});
}
