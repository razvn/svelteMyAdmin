import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection.ts';
import { parseConfig } from '../config/loader.ts';
import { buildEffectiveConfig } from '../preferences/effective.ts';
import { parseImport } from '#lib/preferences/logic.ts';
import { deleteUserConfig, loadUserConfig, saveUserConfig, userConfigTable } from './userconfig.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`user preferences in the configuration storage against ${name}`, () => {
		let conn: Connection | undefined;
		const table = userConfigTable({ pmadb: 'phpmyadmin', userconfig: 'pma__userconfig' })!;
		const user = `tmp_t8b_int_${port}`;

		const cleanup = async () => {
			if (conn) await deleteUserConfig(conn, table, user);
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
				await conn.query(`SELECT 1 FROM ${table} LIMIT 1`);
				await cleanup();
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} or its pmadb unreachable, skipping`);
			}
		});
		afterAll(async () => {
			await cleanup();
			await conn?.end();
		});

		it('is only enabled when the table is configured', () => {
			expect(userConfigTable({ pmadb: '', userconfig: 'pma__userconfig' })).toBeNull();
			expect(userConfigTable({ pmadb: 'phpmyadmin', userconfig: '' })).toBeNull();
		});

		it('returns null for an unknown user', async (ctx) => {
			if (!conn) return ctx.skip();
			expect(await loadUserConfig(conn, table, user)).toBeNull();
		});

		it('saves, loads, updates and resets a flat JSON config_data', async (ctx) => {
			if (!conn) return ctx.skip();
			await saveUserConfig(conn, table, user, { MaxRows: 50, 'Export/format': 'csv' });
			const [raw] = await conn.query(`SELECT config_data FROM ${table} WHERE username = ?`, [user]);
			expect(JSON.parse((raw as { config_data: string }[])[0].config_data)).toEqual({
				MaxRows: 50,
				'Export/format': 'csv'
			});
			const loaded = await loadUserConfig(conn, table, user);
			expect(loaded?.data).toEqual({ MaxRows: 50, 'Export/format': 'csv' });
			expect(loaded?.mtime).toBeGreaterThan(0);

			await saveUserConfig(conn, table, user, { ShowStats: false });
			expect((await loadUserConfig(conn, table, user))?.data).toEqual({ ShowStats: false });
			const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM ${table} WHERE username = ?`, [
				user
			]);
			expect(Number((rows as { n: number }[])[0].n)).toBe(1);

			// reset stores PHP's empty array
			await saveUserConfig(conn, table, user, {});
			expect((await loadUserConfig(conn, table, user))?.data).toEqual({});
		});

		it('reads a row written by phpMyAdmin (escaped slashes) into the effective config', async (ctx) => {
			if (!conn) return ctx.skip();
			const phpJson = '{"MaxRows":10,"Export\\/format":"csv","LoginCookieValidity":5}';
			await conn.query(
				`INSERT INTO ${table} (username, timevalue, config_data) VALUES (?, NOW(), ?) ON DUPLICATE KEY UPDATE config_data = VALUES(config_data)`,
				[user, phpJson]
			);
			const loaded = await loadUserConfig(conn, table, user);
			const cfg = parseConfig({});
			const eff = buildEffectiveConfig(cfg, loaded!.data, 1);
			expect(eff.config.MaxRows).toBe(10);
			expect((eff.config.Export as Record<string, unknown>).format).toBe('csv');
			expect(eff.config.LoginCookieValidity).toBe(1440);
			expect(eff.applied).toEqual({ MaxRows: 10, 'Export/format': 'csv' });
		});

		it('round-trips an import through the storage', async (ctx) => {
			if (!conn) return ctx.skip();
			const cfg = parseConfig({}) as unknown as Record<string, unknown>;
			const res = parseImport('{"DefaultTabTable":"structure","MaxRows":25}', {
				disallow: [],
				developerTab: false,
				base: cfg
			});
			expect(res.ok).toBe(true);
			if (!res.ok) return;
			await saveUserConfig(conn, table, user, res.data);
			expect((await loadUserConfig(conn, table, user))?.data).toEqual({
				DefaultTabTable: 'structure'
			});
		});
	});
}
