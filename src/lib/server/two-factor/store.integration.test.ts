import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../config/loader.ts';
import { createConnection, type Connection } from '../db/connection.ts';
import { deleteUserConfig, loadUserConfig, saveUserConfig } from '../pmadb/userconfig.ts';
import { readTwoFactorConfig } from './config.ts';
import { loadTwoFactor, saveTwoFactor } from './store.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`2fa config in the configuration storage against ${name}`, () => {
		const server = parseConfig({
			Servers: [
				{
					host: '127.0.0.1',
					port,
					controluser: 'pma',
					controlpass: 'pmapass',
					pmadb: 'phpmyadmin',
					userconfig: 'pma__userconfig'
				}
			]
		}).Servers[0];
		const user = `tmp_t9d_int_${port}`;
		let root: Connection | undefined;
		const own = { get: async () => root! };

		const cleanup = async () => {
			if (root) await deleteUserConfig(root, '`phpmyadmin`.`pma__userconfig`', user);
		};

		beforeAll(async () => {
			try {
				root = await createConnection(
					{ ...server, host: '127.0.0.1', port, socket: '' },
					'root',
					'root'
				);
				await root.query('SELECT 1 FROM `phpmyadmin`.`pma__userconfig` LIMIT 1');
				await cleanup();
			} catch {
				root = undefined;
				console.warn(`[integration] ${name} or its pmadb unreachable, skipping`);
			}
		});
		afterAll(async () => {
			await cleanup();
			await root?.end();
		});

		it('has no 2fa for an unknown user', async (ctx) => {
			if (!root) return ctx.skip();
			const r = await loadTwoFactor(server, own, user);
			expect(r?.config).toEqual({ backend: '', settings: {} });
		});

		it('saves and loads the application backend as phpMyAdmin writes it', async (ctx) => {
			if (!root) return ctx.skip();
			expect(
				await saveTwoFactor(server, own, user, {
					backend: 'application',
					settings: { secret: 'JBSWY3DPEHPK3PXP' }
				})
			).toBe(true);
			const raw = await loadUserConfig(root, '`phpmyadmin`.`pma__userconfig`', user);
			expect(raw?.data['2fa']).toEqual({
				backend: 'application',
				settings: { secret: 'JBSWY3DPEHPK3PXP' }
			});
			const [rows] = await root.query(
				'SELECT config_data FROM `phpmyadmin`.`pma__userconfig` WHERE username = ?',
				[user]
			);
			expect(JSON.parse((rows as { config_data: string }[])[0].config_data)).toEqual({
				'2fa': { backend: 'application', settings: { secret: 'JBSWY3DPEHPK3PXP' } }
			});
			expect((await loadTwoFactor(server, own, user))?.config).toEqual({
				backend: 'application',
				settings: { secret: 'JBSWY3DPEHPK3PXP' }
			});
		});

		it('keeps other preferences when saving and when disabling', async (ctx) => {
			if (!root) return ctx.skip();
			const table = '`phpmyadmin`.`pma__userconfig`';
			await saveUserConfig(root, table, user, {
				'Export/format': 'csv',
				'2fa': { backend: 'application', settings: { secret: 'AAAA' } }
			});
			await saveTwoFactor(server, own, user, {
				backend: 'WebAuthn',
				settings: { userHandle: 'h' }
			});
			let stored = await loadUserConfig(root, table, user);
			expect(stored?.data['Export/format']).toBe('csv');
			expect(readTwoFactorConfig(stored!.data).backend).toBe('WebAuthn');

			await saveTwoFactor(server, own, user, { backend: '', settings: {} });
			stored = await loadUserConfig(root, table, user);
			expect(stored?.data['Export/format']).toBe('csv');
			expect(stored?.data['2fa']).toEqual({ backend: '', settings: [] });
			expect((await loadTwoFactor(server, own, user))?.config).toEqual({
				backend: '',
				settings: {}
			});
		});

		it('reports an unconfigured storage as null', async () => {
			const bare = parseConfig({ Servers: [{ host: '127.0.0.1', port }] }).Servers[0];
			expect(await loadTwoFactor(bare, own, user)).toBeNull();
		});
	});
}
