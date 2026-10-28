import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { verifyClause } from '../src/lib/server/table/signed-clause.ts';

const FIXTURE = 'sma_test';
const DB = 'tmp_t4e_e2e';
// config.sample.json, which the preview server runs with
const SECRET = 'change-me-to-a-long-random-string-of-at-least-32-chars';
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
				`CREATE TABLE \`${DB}\`.\`items\` (id int NOT NULL PRIMARY KEY, name varchar(50) NOT NULL)`
			);
			await c.query(
				`INSERT INTO \`${DB}\`.\`items\` (id, name) VALUES (1, 'apple pie'), (2, 'apple tart'), (3, 'plum')`
			);
		});
		dbUp = true;
	} catch {
		dbUp = false;
	}
});

test.afterAll(async () => {
	if (dbUp) await withRoot((c) => c.query(`DROP DATABASE IF EXISTS \`${DB}\``));
});

test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await page.goto('/login');
	await page.getByLabel('Username').fill('root');
	await page.getByLabel('Password').fill('root');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
});

test('search books by title LIKE redirects to browse with a signed filter', async ({ page }) => {
	await page.goto(`/db/${FIXTURE}/table/books/search`);
	// bound selects are reset by hydration, so wait for it before touching the form
	await page.waitForLoadState('networkidle');
	const main = page.getByRole('main');
	await expect(main.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
	const row = main.getByTestId('qbe-row-title');
	await row.getByLabel('Operator for title').selectOption('LIKE %...%');
	await row.getByLabel('Value for title').fill('Left');
	await main.getByRole('button', { name: 'Go', exact: true }).click();

	await page.waitForURL(/\/db\/sma_test\/table\/books\/browse\?/);
	const url = new URL(page.url());
	const filter = url.searchParams.get('filter');
	expect(filter).toBe("`title` LIKE '%Left%'");
	expect(verifyClause(SECRET, FIXTURE, 'books', filter!, url.searchParams.get('fsig'))).toBe(true);
	// bound to the table and clause
	expect(verifyClause(SECRET, FIXTURE, 'authors', filter!, url.searchParams.get('fsig'))).toBe(
		false
	);
});

test('search combines criteria, BETWEEN and the custom where clause', async ({ page }) => {
	await page.goto(`/db/${FIXTURE}/table/books/search`);
	// bound selects are reset by hydration, so wait for it before touching the form
	await page.waitForLoadState('networkidle');
	const main = page.getByRole('main');
	const price = main.getByTestId('qbe-row-price');
	await price.getByLabel('Operator for price').selectOption('BETWEEN');
	await price.getByLabel('Minimum for price').fill('9');
	await price.getByLabel('Maximum for price').fill('13');
	await main
		.getByTestId('qbe-row-status')
		.getByLabel('Value for status')
		.selectOption(['published']);
	await main.getByRole('button', { name: 'Go', exact: true }).click();
	await page.waitForURL(/browse\?/);
	let url = new URL(page.url());
	expect(url.searchParams.get('filter')).toBe(
		"`price` BETWEEN 9 AND 13 AND `status` = 'published'"
	);

	await page.goto(`/db/${FIXTURE}/table/books/search`);
	// bound selects are reset by hydration, so wait for it before touching the form
	await page.waitForLoadState('networkidle');
	await main.getByLabel('Or add search conditions', { exact: false }).fill('id < 3');
	await main.getByRole('button', { name: 'Go', exact: true }).click();
	await page.waitForURL(/browse\?/);
	url = new URL(page.url());
	expect(url.searchParams.get('filter')).toBe('id < 3');
	expect(verifyClause(SECRET, FIXTURE, 'books', 'id < 3', url.searchParams.get('fsig'))).toBe(true);
});

test('zoom search plots the books and opens a row in a side sheet', async ({ page }) => {
	await page.goto(`/db/${FIXTURE}/table/books/zoom-search`);
	// bound selects are reset by hydration, so wait for it before touching the form
	await page.waitForLoadState('networkidle');
	const main = page.getByRole('main');
	await main.getByLabel('X axis column').selectOption('price');
	await main.getByLabel('Y axis column').selectOption('id');
	await main.getByRole('button', { name: 'Go', exact: true }).click();

	const result = main.getByTestId('zoom-result');
	await expect(result).toBeVisible();
	const points = result.locator('circle[data-point]');
	await expect(points).toHaveCount(4);

	await points.nth(1).hover();
	await expect(result.getByRole('tooltip')).toContainText('price');

	await points.nth(1).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByTestId('zoom-row')).toContainText('The Dispossessed');
	const edit = sheet.getByRole('link', { name: 'Edit this row' });
	const href = new URL((await edit.getAttribute('href'))!, page.url());
	expect(href.pathname).toBe(`/db/${FIXTURE}/table/books/insert`);
	const where = href.searchParams.get('where')!;
	expect(where).toContain('`id`');
	expect(verifyClause(SECRET, FIXTURE, 'books', where, href.searchParams.get('sig'))).toBe(true);
});

test('zoom search narrows the points with a criterion', async ({ page }) => {
	await page.goto(
		`/db/${FIXTURE}/table/books/zoom-search?go=1&col_0=price&col_1=id&op_0=%3E&val_0=9&limit=500`
	);
	const result = page.getByRole('main').getByTestId('zoom-result');
	await expect(result.locator('circle[data-point]')).toHaveCount(2);
});

test('find and replace previews and replaces text in a table', async ({ page }) => {
	await page.goto(`/db/${DB}/table/items/find-replace`);
	// bound selects are reset by hydration, so wait for it before touching the form
	await page.waitForLoadState('networkidle');
	const main = page.getByRole('main');
	await main.getByLabel('Find:').fill('apple');
	await main.getByLabel('Replace with:').fill('pear');
	await main.getByRole('button', { name: 'Preview' }).click();

	const preview = main.getByTestId('replace-preview');
	await expect(preview).toContainText('2 rows would be changed');
	await expect(preview).toContainText('apple pie');
	await expect(preview).toContainText('pear pie');

	await main.getByTestId('replace-button').click();
	await expect(main.getByTestId('replace-result')).toContainText('2 rows affected');
	const names = await withRoot(async (c) => {
		const [rows] = await c.query(`SELECT name FROM \`${DB}\`.items ORDER BY id`);
		return (rows as { name: string }[]).map((r) => r.name);
	});
	expect(names).toEqual(['pear pie', 'pear tart', 'plum']);
});

test('find and replace with a regular expression', async ({ page }) => {
	await page.goto(`/db/${DB}/table/items/find-replace`);
	// bound selects are reset by hydration, so wait for it before touching the form
	await page.waitForLoadState('networkidle');
	const main = page.getByRole('main');
	await main.getByLabel('Find:').fill('^p(.)');
	await main.getByLabel('Replace with:').fill('P-$1');
	await main.getByLabel('Use regular expression').click();
	await main.getByRole('button', { name: 'Preview' }).click();
	await expect(main.getByTestId('replace-preview')).toContainText('3 rows would be changed');
	await expect(main.getByTestId('replace-preview')).toContainText('P-e');

	await main.getByLabel('Find:').fill('(');
	await main.getByRole('button', { name: 'Preview' }).click();
	await expect(main.getByRole('alert')).toBeVisible();
});
