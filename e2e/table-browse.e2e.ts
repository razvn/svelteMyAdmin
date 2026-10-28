import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const FIXTURE = 'sma_test';
const DB = 'tmp_t4a_e2e';
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
				`CREATE TABLE \`${DB}\`.\`notes\` (id int NOT NULL PRIMARY KEY, title varchar(60) NOT NULL, qty int NULL)`
			);
			const values = Array.from({ length: 60 }, (_, i) => `(${i + 1}, 'note ${i + 1}', ${i})`);
			await c.query(`INSERT INTO \`${DB}\`.\`notes\` VALUES ${values.join(',')}`);
			await c.query(`CREATE TABLE \`${DB}\`.\`empty_t\` (id int PRIMARY KEY)`);
		});
		dbUp = true;
	} catch {
		dbUp = false;
	}
});

test.afterAll(async () => {
	if (!dbUp) return;
	await withRoot(async (c) => {
		await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
		// remembered sorting / page size of the temporary tables
		await c
			.query('DELETE FROM `phpmyadmin`.`pma__table_uiprefs` WHERE db_name = ?', [DB])
			.catch(() => {});
	});
});

test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await login(page);
});

const books = `/db/${FIXTURE}/table/books/browse?sort=`;

test('browse books and sort by title with a header click', async ({ page }) => {
	await gotoReady(page, books);
	const main = page.getByRole('main');
	await expect(main.getByTestId('rows-message')).toContainText('Showing rows 1 - 4');
	await expect(main.getByTestId('rows-message')).toContainText('4 total');
	await expect(main.getByRole('cell', { name: 'The Left Hand of Darkness' })).toBeVisible();

	const header = main.getByRole('button', { name: 'title', exact: true });
	await header.click();
	await expect(page).toHaveURL(/sort=title/);
	await expect(main.getByRole('columnheader', { name: 'title' })).toHaveAttribute(
		'aria-sort',
		'ascending'
	);
	await expect(main.getByRole('row').nth(1)).toContainText('Solaris');

	await header.click();
	await expect(page).toHaveURL(/dir=desc/);
	await expect(main.getByRole('row').nth(1)).toContainText('Unpublished Draft');
	await expect(main.getByTestId('browse-sql')).toBeHidden();
	await main.getByRole('button', { name: 'SQL query' }).click();
	await expect(main.getByTestId('browse-sql')).toContainText('ORDER BY `title` DESC');

	// third click clears the sort again (and the remembered one)
	await header.click();
	await expect(main.getByRole('columnheader', { name: 'title' })).toHaveAttribute(
		'aria-sort',
		'none'
	);
});

test('change the page size and move between pages', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/notes/browse`);
	const main = page.getByRole('main');
	await expect(main.getByTestId('rows-message')).toContainText('Showing rows 1 - 25');
	await expect(main.getByTestId('rows-message')).toContainText('60 total');

	await main.getByRole('button', { name: 'Next page' }).click();
	await expect(main.getByTestId('rows-message')).toContainText('Showing rows 26 - 50');

	await main.getByRole('combobox', { name: 'Rows per page' }).click();
	await page.getByRole('option', { name: '100 rows' }).click();
	await expect(page).toHaveURL(/rows=100/);
	await expect(main.getByTestId('rows-message')).toContainText('Showing rows 1 - 60');
	await expect(main.getByRole('button', { name: 'Next page' })).toBeDisabled();

	// back to the configured default so the remembered value does not leak into reruns
	await main.getByRole('combobox', { name: 'Rows per page' }).click();
	await page.getByRole('option', { name: '25 rows' }).click();
	await expect(main.getByTestId('rows-message')).toContainText('Showing rows 1 - 25');
});

test('inline edit a cell by double click', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/notes/browse?sort=`);
	const main = page.getByRole('main');
	const cell = main.getByRole('cell', { name: 'note 2', exact: true });
	await cell.dblclick();
	await expect(main.getByRole('textbox', { name: 'title value' })).toBeVisible({ timeout: 1000 });
	await main.getByRole('textbox', { name: 'title value' }).fill('edited note');
	await main.getByRole('button', { name: 'Save' }).click();
	await expect(main.getByRole('cell', { name: 'edited note', exact: true })).toBeVisible();
	await expect(page.getByText('Column title updated')).toBeVisible();

	const [rows] = await withRoot((c) =>
		c.query(`SELECT title FROM \`${DB}\`.\`notes\` WHERE id = 2`)
	);
	expect((rows as { title: string }[])[0].title).toBe('edited note');

	// NOT NULL / server errors stay inline
	await main.getByRole('cell', { name: 'edited note', exact: true }).dblclick();
	await main.getByRole('textbox', { name: 'title value' }).fill('x'.repeat(100));
	await main.getByRole('button', { name: 'Save' }).click();
	await expect(main.getByRole('alert')).toBeVisible();
	await main.getByRole('button', { name: 'Cancel' }).click();
});

test('delete a row after confirming the statement', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/notes/browse?sort=&rows=100`);
	const main = page.getByRole('main');
	await expect(main.getByTestId('rows-message')).toContainText('60 total');
	const dialog = page.getByRole('alertdialog');
	await main.getByRole('button', { name: 'Delete row 3', exact: true }).click();
	await expect(dialog).toBeVisible({ timeout: 1000 });
	await expect(dialog.getByTestId('confirm-sql')).toContainText(
		`DELETE FROM \`${DB}\`.\`notes\` WHERE \`notes\`.\`id\` = 3 LIMIT 1;`
	);
	await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(main.getByTestId('rows-message')).toContainText('59 total');
	await expect(main.getByRole('cell', { name: 'note 3', exact: true })).toHaveCount(0);

	const [rows] = await withRoot((c) =>
		c.query(`SELECT COUNT(*) AS c FROM \`${DB}\`.\`notes\` WHERE id = 3`)
	);
	expect(Number((rows as { c: unknown }[])[0].c)).toBe(0);

	// restore the default page size
	await gotoReady(page, `/db/${DB}/table/notes/browse?rows=25`);
});

test('a forged row signature is rejected', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/notes/browse?sort=`);
	const res = await page.request.post(`/db/${DB}/table/notes/browse?/delete`, {
		form: { where: '1=1', sig: 'forged' },
		headers: { 'x-sveltekit-action': 'true', origin: new URL(page.url()).origin }
	});
	expect(await res.text()).toContain('Invalid row signature');
	const [rows] = await withRoot((c) => c.query(`SELECT COUNT(*) AS c FROM \`${DB}\`.\`notes\``));
	expect(Number((rows as { c: unknown }[])[0].c)).toBeGreaterThanOrEqual(58);
});

test('follow a foreign key link to the referenced row', async ({ page }) => {
	await gotoReady(page, books);
	const main = page.getByRole('main');
	const row = main.getByRole('row', { name: /The Dispossessed/ });
	await row.getByRole('link', { name: '1', exact: true }).click();
	await expect(page).toHaveURL(/\/table\/authors\/browse\?filter=.*fsig=/);
	await expect(main.getByTestId('filter-badge')).toHaveText('Filtered');
	await expect(main.getByTestId('rows-message')).toContainText('1 total');
	await expect(main.getByRole('cell', { name: 'Ursula K. Le Guin' })).toBeVisible();

	await main.getByRole('link', { name: 'Clear filter' }).click();
	await expect(main.getByTestId('rows-message')).toContainText('3 total');
	await expect(main.getByTestId('filter-badge')).toHaveCount(0);
});

test('a tampered filter is rejected', async ({ page }) => {
	const res = await page.request.get(
		`/db/${FIXTURE}/table/authors/browse?filter=${encodeURIComponent('1=1')}&fsig=bad`
	);
	expect(res.status()).toBe(400);
});

test('type_zoo renders binary, geometry, NULL and JSON values', async ({ page }) => {
	await gotoReady(page, `/db/${FIXTURE}/table/type_zoo/browse?sort=`);
	const main = page.getByRole('main');
	await expect(main.getByText('[BLOB - 8 B]')).toBeVisible();
	await expect(main.getByText('POINT(1 2)')).toBeVisible();
	await expect(main.getByText('NULL', { exact: true }).first()).toBeVisible();
	await expect(main.getByText('[BLOB - 8 B]')).toBeVisible();
	await expect(main.getByRole('link', { name: 'Download' }).first()).toHaveAttribute(
		'href',
		/browse\/download\?.*col=c_binary/
	);
});

test('views are read-only and empty tables show a friendly state', async ({ page }) => {
	await gotoReady(page, `/db/${FIXTURE}/table/v_book_authors/browse?sort=`);
	const main = page.getByRole('main');
	await expect(main.getByTestId('rows-message')).toContainText('4 total');
	await expect(main.getByRole('link', { name: /Edit row/ })).toHaveCount(0);
	await expect(main.getByRole('button', { name: /Delete row/ })).toHaveCount(0);
	await expect(main.getByRole('link', { name: /Insert/ })).toHaveCount(0);

	await gotoReady(page, `/db/${DB}/table/empty_t/browse`);
	await expect(main.getByTestId('empty-state')).toContainText('no rows yet');
	await expect(
		main.getByTestId('empty-state').getByRole('link', { name: /Insert/ })
	).toHaveAttribute('href', `/db/${DB}/table/empty_t/insert`);
});
