import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady } from './helpers.ts';

// Dedicated user: the language chosen in the user menu is saved as its `lang` preference.
const USER = 'tmp_i18n_server_u';
const PASSWORD = 'I18n-Server-1!';

async function withRoot<T>(fn: (c: Awaited<ReturnType<typeof createConnection>>) => Promise<T>) {
	const c = await createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root',
		connectTimeout: 2000
	});
	try {
		return await fn(c);
	} finally {
		await c.end();
	}
}
const cleanup = () =>
	withRoot(async (c) => {
		await c.query(`DROP USER IF EXISTS '${USER}'@'%'`);
		await c.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER]);
	});

let dbUp = false;
test.beforeAll(async () => {
	try {
		await cleanup();
		await withRoot(async (c) => {
			await c.query(`CREATE USER '${USER}'@'%' IDENTIFIED BY '${PASSWORD}'`);
			await c.query(`GRANT SELECT ON sma_test.* TO '${USER}'@'%'`);
		});
		dbUp = true;
	} catch {
		dbUp = false;
	}
});
test.afterAll(async () => {
	if (dbUp) await cleanup();
});

test('server status and privileges pages are translated (fr, es)', async ({
	page,
	context,
	baseURL
}) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');

	await context.addCookies([{ name: 'sma_lang', value: 'fr', url: baseURL! }]);
	await gotoReady(page, '/login');
	await page.getByLabel('Utilisateur').fill(USER);
	await page.getByLabel('Mot de passe').fill(PASSWORD);
	await page.getByRole('button', { name: 'Connexion' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');

	const main = page.getByRole('main');
	await gotoReady(page, '/server/status');
	await expect(main.getByRole('heading', { name: 'État du serveur' })).toBeVisible();
	await expect(main.getByText('Durée de fonctionnement')).toBeVisible();
	await expect(main.getByText('Trafic').first()).toBeVisible();
	await expect(page.getByRole('link', { name: 'Statistiques sur les requêtes' })).toBeVisible();

	await gotoReady(page, '/server/privileges');
	await expect(main.getByRole('heading', { name: 'Comptes utilisateurs' })).toBeVisible();
	await expect(main.getByText('Aucun privilège')).toBeVisible();

	// Español: the cookie decides, no re-login needed.
	await context.addCookies([{ name: 'sma_lang', value: 'es', url: baseURL! }]);
	await gotoReady(page, '/server/status');
	await expect(main.getByRole('heading', { name: 'Estado del servidor' })).toBeVisible();
	await expect(main.getByText('Tiempo de actividad')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Estadísticas de Consulta' })).toBeVisible();

	await gotoReady(page, '/server/privileges');
	await expect(main.getByRole('heading', { name: 'Cuentas de usuarios' })).toBeVisible();
	await expect(main.getByText('Sin privilegios')).toBeVisible();
});
