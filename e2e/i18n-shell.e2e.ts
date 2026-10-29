import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady } from './helpers.ts';

// Dedicated user: the language chosen in the user menu is saved as its `lang` preference.
const USER = 'tmp_i18n_shell_u';
const PASSWORD = 'I18n-Shell-1!';

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

test('sidebar, top bar and tab bar are translated, the user menu switches language', async ({
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
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');

	await gotoReady(page, '/server/databases');
	await expect(page.getByRole('link', { name: 'Accueil', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Menu utilisateur' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Ouvrir la palette de commandes' })).toBeVisible();
	await expect(page.locator('[data-tab="databases"]')).toHaveText(/Bases de données/);

	// User menu: Español
	await page.getByRole('button', { name: 'Menu utilisateur' }).click();
	await page.getByRole('menuitem', { name: 'Langue' }).click();
	await page.getByRole('menuitemradio', { name: /Español/ }).click();
	await expect(page.getByRole('button', { name: 'Menú de usuario' })).toBeVisible();
	await expect(page.locator('[data-tab="databases"]')).toHaveText(/Bases de datos/);
	await expect(page.getByRole('button', { name: 'Abrir la paleta de comandos' })).toBeVisible();
});
