import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const DB = 'tmp_t5a_e2e';
let dbUp = false;

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

test.beforeAll(async () => {
	try {
		await withRoot(async (c) => {
			await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
			await c.query(`CREATE DATABASE \`${DB}\``);
			await c.query(
				`CREATE TABLE \`${DB}\`.\`books\` (id int NOT NULL PRIMARY KEY, title varchar(60) NOT NULL)`
			);
			const values = Array.from({ length: 60 }, (_, i) => `(${i + 1}, 'book ${i + 1}')`);
			await c.query(`INSERT INTO \`${DB}\`.\`books\` VALUES ${values.join(',')}`);
		});
		dbUp = true;
	} catch {
		dbUp = false;
	}
});

test.afterAll(async () => {
	if (!dbUp) return;
	await withRoot((c) => c.query(`DROP DATABASE IF EXISTS \`${DB}\``));
});

test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL docker not reachable');
	await login(page);
});

const tableUrl = `/db/${DB}/table/books/sql`;
const editor = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'SQL query' });
const results = (page: Page) => page.getByTestId('statement-result');

async function runQuery(page: Page, sql: string) {
	await editor(page).fill(sql);
	await page.getByRole('main').getByRole('button', { name: 'Go' }).click();
}

test('table level: prefilled query runs and shows a grid', async ({ page }) => {
	await gotoReady(page, tableUrl);
	await expect(editor(page)).toContainText('SELECT * FROM `books` WHERE 1');
	await page.getByRole('main').getByRole('button', { name: 'Go' }).click();
	await expect(results(page)).toHaveCount(1);
	await expect(page.getByTestId('statement-message')).toContainText(
		'Showing rows 0 - 24 (60 total'
	);
	await expect(
		page.getByRole('main').getByRole('cell', { name: 'book 1', exact: true })
	).toBeVisible();
	// Row actions: the result maps to one table with a primary key.
	await expect(page.getByRole('button', { name: 'Delete row 1', exact: true })).toBeVisible();
});

test('pagination and header sorting re-run the statement', async ({ page }) => {
	await gotoReady(page, tableUrl);
	await page.getByRole('main').getByRole('button', { name: 'Go' }).click();
	await page.getByRole('button', { name: 'Next page' }).first().click();
	await expect(page.getByTestId('statement-message')).toContainText('Showing rows 25 - 49');
	await page.getByTestId('result-scroll').getByRole('button', { name: 'id' }).click();
	await expect(page.getByTestId('statement-sql')).toContainText('ORDER BY `id` ASC');
	await expect(page.getByTestId('statement-message')).toContainText('Showing rows 0 - 24');
});

test('multi statement script gives one block per statement', async ({ page }) => {
	await gotoReady(page, tableUrl);
	await runQuery(page, 'SELECT 1 AS a; SELECT 2 AS b; UPDATE books SET title = title WHERE id = 1');
	await expect(results(page)).toHaveCount(3);
	await expect(results(page).nth(2).getByTestId('statement-message')).toContainText(
		'1 row affected.'
	);
});

test('syntax error shows #1064 and Edit puts the query back', async ({ page }) => {
	await gotoReady(page, tableUrl);
	await runQuery(page, 'SELEC 1');
	await expect(page.getByTestId('statement-error')).toContainText('#1064');
	await editor(page).fill('something else');
	await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
	await expect(editor(page)).toContainText('SELEC 1');
});

test('?sql_query only prefills and never executes', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/sql?sql_query=${encodeURIComponent('SELECT 99 AS x')}`);
	await expect(editor(page)).toContainText('SELECT 99 AS x');
	await expect(page.getByTestId('statement-result')).toHaveCount(0);
});

test('server level runs a query', async ({ page }) => {
	await gotoReady(page, '/server/sql');
	await runQuery(page, 'SELECT 7 AS seven');
	await expect(page.getByTestId('statement-message')).toContainText('Showing rows 0 - 0 (1 total');
	// no table behind the result: no row actions
	await expect(page.getByRole('button', { name: /Delete row/ })).toHaveCount(0);
});
