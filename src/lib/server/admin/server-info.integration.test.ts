import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { groupCollations, listCharsetGroups } from './charsets.ts';
import { findEngine, getInnodbStatus, listEngines, listEngineVariables } from './engines.ts';
import { groupPluginsByType, listPlugins } from './plugins.ts';
import { VariableError, listVariableRows, setGlobalVariable } from './variables.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306, type: 'MySQL' },
	{ name: 'mariadb 11.4', port: 33307, type: 'MariaDB' }
];

for (const { name, port, type } of servers) {
	describe(`server info pages against ${name}`, () => {
		let conn: Connection | undefined;

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
			} catch {
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.end();
		});

		describe('variables', () => {
			it('lists global values, with session values only where they differ', async ({ skip }) => {
				if (!conn) return skip();
				const rows = await listVariableRows(conn);
				const maxConnect = rows.find((r) => r.name === 'max_connect_errors');
				expect(maxConnect).toBeDefined();
				expect(maxConnect!.display).toMatch(/^[\d,]+$/);
				expect(rows.length).toBeGreaterThan(100);
				for (const row of rows) {
					if (row.sessionDisplay !== null) expect(row.sessionDisplay).not.toBe(row.display);
				}
			});

			it('formats byte variables with a unit', async ({ skip }) => {
				if (!conn) return skip();
				const keyBuffer = (await listVariableRows(conn)).find((r) => r.name === 'key_buffer_size');
				expect(keyBuffer).toBeDefined();
				expect(keyBuffer!.display).toMatch(/ (B|KiB|MiB|GiB)$/);
				expect(keyBuffer!.title).toBe(keyBuffer!.value);
			});

			it('sets a global variable and restores the original value', async ({ skip }) => {
				if (!conn) return skip();
				const [[before]] = await conn.query<RowDataPacket[]>(
					'SELECT @@GLOBAL.max_connect_errors AS v'
				);
				const original = String(before.v);
				const target = original === '4242' ? '4243' : '4242';
				try {
					const after = await setGlobalVariable(conn, 'max_connect_errors', target);
					expect(after).toEqual({ name: 'max_connect_errors', value: target });
				} finally {
					await setGlobalVariable(conn, 'max_connect_errors', original);
				}
				const [[restored]] = await conn.query<RowDataPacket[]>(
					'SELECT @@GLOBAL.max_connect_errors AS v'
				);
				expect(String(restored.v)).toBe(original);
			});

			it('rejects unknown variables and shows the server error for read-only ones', async ({
				skip
			}) => {
				if (!conn) return skip();
				await expect(setGlobalVariable(conn, 'no_such_variable_xyz', '1')).rejects.toBeInstanceOf(
					VariableError
				);
				const readOnly = await setGlobalVariable(conn, 'version', 'x').catch((e: unknown) => e);
				expect((readOnly as { sqlMessage?: string }).sqlMessage).toMatch(/read only/);
			});
		});

		describe('charsets', () => {
			it('nests collations under their charset and marks the server default', async ({ skip }) => {
				if (!conn) return skip();
				const groups = await listCharsetGroups(conn);
				const utf8mb4 = groups.find((g) => g.name === 'utf8mb4');
				expect(utf8mb4).toBeDefined();
				expect(utf8mb4!.description).toBeTruthy();
				expect(utf8mb4!.collations.length).toBeGreaterThan(1);
				if (type === 'MySQL') {
					expect(utf8mb4!.collations.some((c) => c.isDefault)).toBe(true);
				} else {
					// MariaDB names a default that COLLATIONS does not list, so no row can carry the mark.
					expect(utf8mb4!.defaultCollation).toBeTruthy();
				}
				const serverDefaults = groups.flatMap((g) => g.collations).filter((c) => c.isServerDefault);
				expect(serverDefaults).toHaveLength(1);
				expect(groupCollations([], [], '')).toEqual([]);
			});
		});

		describe('engines', () => {
			it('lists the engines with their support state', async ({ skip }) => {
				if (!conn) return skip();
				const engines = await listEngines(conn);
				const innodb = engines.find((e) => e.name === 'InnoDB');
				expect(innodb).toMatchObject({ support: 'DEFAULT', transactions: 'YES' });
				expect(engines.find((e) => e.name === 'MEMORY')?.support).toBe('YES');
			});

			it('finds an engine case-insensitively and lists its variables', async ({ skip }) => {
				if (!conn) return skip();
				const engine = await findEngine(conn, 'innodb');
				expect(engine?.name).toBe('InnoDB');
				expect(await findEngine(conn, 'no_such_engine')).toBeNull();
				const variables = await listEngineVariables(conn, 'InnoDB');
				expect(variables.length).toBeGreaterThan(5);
				expect(variables.every((v) => v.name.startsWith('innodb_'))).toBe(true);
			});

			it('returns the InnoDB status text', async ({ skip }) => {
				if (!conn) return skip();
				expect(await getInnodbStatus(conn)).toContain('BACKGROUND THREAD');
			});

			it(`knows Aria variables on MariaDB only (${type})`, async ({ skip }) => {
				if (!conn) return skip();
				const aria = await listEngineVariables(conn, 'Aria');
				if (type === 'MariaDB') {
					expect(aria.length).toBeGreaterThan(0);
				} else {
					expect(aria).toEqual([]);
				}
			});
		});

		describe('plugins', () => {
			it('lists plugins grouped by type', async ({ skip }) => {
				if (!conn) return skip();
				const rows = await listPlugins(conn);
				const groups = groupPluginsByType(rows);
				const storage = groups.find((g) => g.type === 'STORAGE ENGINE');
				expect(storage).toBeDefined();
				expect(storage!.plugins.find((p) => p.name === 'InnoDB')).toMatchObject({
					status: 'ACTIVE'
				});
				expect(groups.map((g) => g.type)).toEqual([...groups.map((g) => g.type)].sort());
			});
		});
	});
}
