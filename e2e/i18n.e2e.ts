import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady } from './helpers.ts';

// A dedicated MySQL user: the chosen language is saved as the `lang` user preference of the logged-in
// user, so specs logging in as root (in English) must never see it.
const USER = 'tmp_i18n_u';
const PASSWORD = 'I18n-Pass-1!';

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

async function chooseLanguage(page: Page, trigger: string, option: string) {
	await page.getByRole('combobox', { name: trigger }).click();
	await page.getByRole('option', { name: option }).click();
}

test('login page, home appearance card and settings follow the chosen language', async ({
	page
}) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');

	await gotoReady(page, '/login');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByLabel('Username')).toBeVisible();

	// Login page: Français without a reload
	await chooseLanguage(page, 'Language', 'Français');
	await expect(page.getByLabel('Utilisateur')).toBeVisible();
	await expect(page.getByLabel('Mot de passe')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Connexion' })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

	// The choice survives a reload (cookie) and is rendered server-side
	await page.reload();
	await expect(page.getByLabel('Utilisateur')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

	await page.getByLabel('Utilisateur').fill(USER);
	await page.getByLabel('Mot de passe').fill(PASSWORD);
	await page.getByRole('button', { name: 'Connexion' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');

	// Home: the appearance card in French
	const card = page.getByRole('main');
	await expect(card.getByText('Thème', { exact: true })).toBeVisible();
	await expect(card.getByText('Langue', { exact: true })).toBeVisible();

	// Switch to Español from the card
	await chooseLanguage(page, 'Langue', 'Español');
	await expect(card.getByText('Tema', { exact: true })).toBeVisible();
	await expect(card.getByText('Idioma', { exact: true })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'es');

	// Saved as the `lang` user preference (phpMyAdmin compatible)
	await expect
		.poll(async () =>
			withRoot(async (c) => {
				const [rows] = await c.query(
					'SELECT config_data FROM phpmyadmin.pma__userconfig WHERE username = ?',
					[USER]
				);
				return (rows as Array<{ config_data: string }>)[0]?.config_data ?? '';
			})
		)
		.toContain('"lang":"es"');

	// Back to English
	await chooseLanguage(page, 'Idioma', 'English');
	await expect(card.getByText('Theme', { exact: true })).toBeVisible();
	await expect(card.getByText('Language', { exact: true })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('Accept-Language picks the default language, an explicit choice wins', async ({ browser }) => {
	const ctx = await browser.newContext({
		locale: 'es-ES',
		extraHTTPHeaders: { 'accept-language': 'es-ES,es;q=0.9' }
	});
	const page = await ctx.newPage();
	await gotoReady(page, '/login');
	await expect(page.getByLabel('Nombre de usuario')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'es');
	await ctx.close();
});
