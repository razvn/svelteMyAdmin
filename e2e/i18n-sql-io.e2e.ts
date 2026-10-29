import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady } from './helpers.ts';

// A dedicated MySQL user and the `sma_lang` cookie: nothing is saved in root's preferences, so the
// other specs (which log in as root, in English) never see a translated UI.
const USER = 'tmp_i18n_sqlio_u';
const PASSWORD = 'I18nSqlIo-Pass-1!';

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
		sqlHeader: 'Exécuter une ou des requêtes SQL sur le serveur',
		history: 'Historique SQL',
		exportTitle: 'Exportation des bases de données depuis le serveur courant',
		method: "Méthode d'exportation"
	},
	es: {
		sqlHeader: 'Ejecutar consulta(s) SQL en el servidor',
		history: 'Historial SQL',
		exportTitle: 'Exportar bases de datos del servidor actual',
		method: 'Método de exportación'
	}
} as const;

for (const lang of ['fr', 'es'] as const) {
	test(`SQL and export pages are translated (${lang})`, async ({ page, baseURL }) => {
		test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
		const L = LABELS[lang];
		await loginAs(page, baseURL, lang);

		await gotoReady(page, '/server/sql');
		const main = page.getByRole('main');
		await expect(main.getByText(L.sqlHeader)).toBeVisible();
		await expect(main.getByRole('tab', { name: L.history })).toBeVisible();

		await gotoReady(page, '/server/export');
		await expect(main.getByText(L.exportTitle)).toBeVisible();
		await expect(main.getByText(L.method)).toBeVisible();
	});
}
