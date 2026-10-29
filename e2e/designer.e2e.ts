import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createConnection, type Connection } from 'mysql2/promise';
import { gotoReady, login, reloadReady } from './helpers.ts';

const DB = 'sma_test';
const PAGE = 'tmp_t9a_page';

async function connect(): Promise<Connection> {
	return createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root',
		connectTimeout: 2000
	});
}

/** Remove the page created by the test and its coordinates. */
async function cleanup() {
	const c = await connect();
	try {
		const [rows] = await c.query(
			'SELECT page_nr FROM `phpmyadmin`.`pma__pdf_pages` WHERE db_name = ? AND page_descr LIKE ?',
			[DB, 'tmp\\_t9a\\_%']
		);
		for (const r of rows as { page_nr: number }[]) {
			await c.query('DELETE FROM `phpmyadmin`.`pma__table_coords` WHERE pdf_page_number = ?', [
				r.page_nr
			]);
		}
		await c.query(
			'DELETE FROM `phpmyadmin`.`pma__pdf_pages` WHERE db_name = ? AND page_descr LIKE ?',
			[DB, 'tmp\\_t9a\\_%']
		);
	} finally {
		await c.end();
	}
}

async function storedX(table: string): Promise<number | null> {
	const c = await connect();
	try {
		const [rows] = await c.query(
			'SELECT co.x FROM `phpmyadmin`.`pma__table_coords` co JOIN `phpmyadmin`.`pma__pdf_pages` p ' +
				'ON p.page_nr = co.pdf_page_number WHERE p.db_name = ? AND p.page_descr = ? AND co.table_name = ?',
			[DB, PAGE, table]
		);
		const row = (rows as { x: number }[])[0];
		return row ? Number(row.x) : null;
	} finally {
		await c.end();
	}
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(cleanup);
test.afterAll(cleanup);

test('designer shows tables and relations, keeps dragged positions on a page, and exports SVG', async ({
	page
}) => {
	await login(page);
	await gotoReady(page, `/db/${DB}/designer`);
	const main = page.getByRole('main');
	await expect(main.getByTestId('designer-table-authors')).toBeVisible();
	await expect(main.getByTestId('designer-table-books')).toBeVisible();
	await expect(
		main.locator('[data-testid="designer-relation"][data-from="books.author_id"]')
	).toHaveCount(1);

	// create a page: it starts with all tables
	await main.getByRole('button', { name: 'New page' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByPlaceholder('Page name').fill(PAGE);
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(/designer\?page=\d+/);
	await expect(main.getByTestId('designer-page-select')).toContainText(PAGE);
	await expect(main.getByTestId('designer-table-authors')).toBeVisible();
	expect(await storedX('authors')).not.toBeNull();

	// drag the authors table
	const card = main.getByTestId('designer-table-authors');
	const before = await card.evaluate((e) => (e as HTMLElement).style.left);
	const header = main.getByTestId('designer-header-authors');
	const box = (await header.boundingBox())!;
	await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 20 + 60, box.y + box.height / 2 + 25, { steps: 6 });
	await page.mouse.up();
	const moved = await card.evaluate((e) => (e as HTMLElement).style.left);
	expect(moved).not.toBe(before);
	await expect.poll(() => storedX('authors')).toBe(Number.parseFloat(moved));

	await reloadReady(page);
	await expect(main.getByTestId('designer-table-authors')).toHaveCSS('left', moved);

	// export the page as SVG
	await main.getByRole('button', { name: 'Export schema' }).click();
	const exportDialog = page.getByTestId('export-dialog');
	await exportDialog.getByLabel('Format').selectOption('svg');
	const download = page.waitForEvent('download');
	await exportDialog.getByRole('button', { name: 'Export' }).click();
	const file = await (await download).path();
	const svg = await readFile(file, 'utf8');
	expect(svg).toContain('<svg');
	expect(svg).toContain('data-table="authors"');
	expect(svg).toContain('data-table="books"');
});

test('a page can be renamed and deleted', async ({ page }) => {
	await login(page);
	await gotoReady(page, `/db/${DB}/designer`);
	const main = page.getByRole('main');
	const select = main.getByTestId('designer-page-select');
	await main.getByRole('button', { name: 'New page' }).click();
	await page.getByRole('dialog').getByPlaceholder('Page name').fill('tmp_t9a_second');
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(/designer\?page=\d+/);
	await expect(select).toContainText('tmp_t9a_second');

	await main.getByRole('button', { name: 'Rename page' }).click();
	await page.getByRole('dialog').getByPlaceholder('Page name').fill('tmp_t9a_renamed');
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await expect(select).toContainText('tmp_t9a_renamed');
	await expect(select).not.toContainText('tmp_t9a_second');

	await main.getByRole('button', { name: 'Delete page' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
	await expect(select).not.toContainText('tmp_t9a_renamed');
});
