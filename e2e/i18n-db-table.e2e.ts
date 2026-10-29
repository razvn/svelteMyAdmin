import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady } from './helpers.ts';

// A dedicated MySQL user and the `sma_lang` cookie: nothing is saved in root's preferences, so the
// other specs (which log in as root, in English) never see a translated UI.
const USER = 'tmp_i18n_dbtbl_u';
const PASSWORD = 'I18nDbTbl-Pass-1!';

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

async function loginAs(page: Page, baseURL: string | undefined, lang: 'fr' | 'es') {
	// Log in in English, then switch the language with the cookie the language select would set.
	await gotoReady(page, '/login');
	await page.getByLabel('Username').fill(USER);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await page.context().addCookies([{ name: 'sma_lang', value: lang, url: baseURL ?? '' }]);
}

const LABELS = {
	fr: {
		checkAll: 'Tout cocher',
		filter: 'Filtrer les tables',
		showing: /Affichage des lignes 0 - \d+/,
		total: /au total, la requête a pris/
	},
	es: {
		checkAll: 'Seleccionar todo',
		filter: 'Filtrar tablas',
		showing: /Mostrando filas 0 - \d+/,
		total: /en total, la consulta tardó/
	}
} as const;

for (const lang of ['fr', 'es'] as const) {
	test(`database structure and table browse are translated (${lang})`, async ({
		page,
		baseURL
	}) => {
		test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
		const L = LABELS[lang];
		await loginAs(page, baseURL, lang);

		await gotoReady(page, '/db/sma_test/structure');
		const main = page.getByRole('main');
		await expect(main.getByText(L.checkAll, { exact: true })).toBeVisible();
		await expect(main.getByPlaceholder(L.filter)).toBeVisible();
		await expect(main.getByText('Check all', { exact: true })).toHaveCount(0);

		await gotoReady(page, '/db/sma_test/table/books/browse');
		const message = page.getByTestId('rows-message');
		await expect(message).toContainText(L.showing);
		await expect(message).toContainText(L.total);
		await expect(message).not.toContainText('Showing rows');
	});
}
