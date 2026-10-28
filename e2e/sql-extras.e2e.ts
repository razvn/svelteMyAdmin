import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login, reloadReady } from './helpers.ts';

const DB = 'tmp_t5c_e2e';
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
				`CREATE TABLE \`${DB}\`.\`books\` (id int NOT NULL PRIMARY KEY, title varchar(60) NOT NULL, price decimal(8,2) NOT NULL)`
			);
			await c.query(
				`INSERT INTO \`${DB}\`.\`books\` VALUES (1, 'Dune', 10.50), (2, 'Emma', 20), (3, 'Ulysses', 5.25)`
			);
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
		// bookmarks written by these tests (the pmadb is shared with other suites)
		await c.query('DELETE FROM `phpmyadmin`.`pma__bookmark` WHERE `dbase` = ?', [DB]);
	});
});

test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL docker not reachable');
	await login(page);
});

const sqlUrl = `/db/${DB}/sql`;
const editor = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'SQL query' });
const go = (page: Page) => page.getByRole('main').getByRole('button', { name: 'Go' });

async function runQuery(page: Page, sql: string) {
	await editor(page).fill(sql);
	await go(page).click();
}

test('a run query shows up in the history and loads back into the editor', async ({ page }) => {
	const marker = `hist_${Date.now()}`;
	await gotoReady(page, sqlUrl);
	await runQuery(page, `SELECT '${marker}' AS m`);
	await expect(page.getByTestId('statement-message')).toContainText('Showing rows 0 - 0');

	const extras = page.getByTestId('sql-extras');
	const item = extras.getByTestId('history-item').filter({ hasText: marker });
	await expect(item).toHaveCount(1);

	await extras.getByRole('searchbox', { name: 'Search history' }).fill('no-such-query-xyz');
	await expect(extras.getByTestId('history-empty')).toBeVisible();
	await extras.getByRole('searchbox', { name: 'Search history' }).fill(marker);
	await editor(page).fill('SELECT 0');
	await item.click();
	await expect(editor(page)).toContainText(marker);
});

test('a bookmark with a variable runs with the entered value', async ({ page }) => {
	const label = `by-id-${Date.now()}`;
	await gotoReady(page, sqlUrl);
	await editor(page).fill("SELECT title FROM books WHERE id = '[VARIABLE1]'");

	const extras = page.getByTestId('sql-extras');
	await extras.getByRole('tab', { name: 'Bookmark this SQL query' }).click();
	await extras.getByLabel('Label').fill(label);
	await extras.getByTestId('bookmark-form').getByRole('button').click();

	const item = extras.getByTestId('bookmark-item').filter({ hasText: label });
	await expect(item).toHaveCount(1);
	await item.getByRole('button', { name: `Run bookmark ${label}` }).click();
	await item.getByLabel('VARIABLE1').fill('2');
	await item.getByRole('button', { name: 'Run', exact: true }).click();

	await expect(page.getByTestId('statement-sql')).toContainText("WHERE id = '2'");
	await expect(
		page.getByRole('main').getByRole('cell', { name: 'Emma', exact: true })
	).toBeVisible();

	// back on the bookmarks list: delete it
	await extras.getByRole('tab', { name: 'Bookmarks' }).click();
	await item.getByRole('button', { name: `Delete bookmark ${label}` }).click();
	await expect(extras.getByTestId('bookmark-item').filter({ hasText: label })).toHaveCount(0);
});

test('the console runs a query in the current context and survives a reload', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/books/browse`);
	const consolePanel = page.getByTestId('console');
	await expect(consolePanel).toHaveCount(0);
	await page.getByRole('button', { name: 'Toggle SQL console' }).click();
	await expect(consolePanel).toBeVisible();
	await expect(page.getByTestId('console-context')).toContainText(`${DB}.books`);

	await consolePanel.getByRole('textbox', { name: 'Console query' }).fill('SELECT 1 AS one');
	await page.keyboard.press('ControlOrMeta+Enter');
	await expect(consolePanel.getByTestId('console-table')).toContainText('one');
	await expect(consolePanel.getByTestId('console-status')).toContainText('1 row');

	// the context is the route: a table of this db is reachable without qualifying it
	await consolePanel
		.getByRole('textbox', { name: 'Console query' })
		.fill('SELECT COUNT(*) AS n FROM books');
	await consolePanel.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(consolePanel.getByTestId('console-table').last()).toContainText('3');

	await consolePanel.getByRole('tab', { name: 'History' }).click();
	await expect(consolePanel.getByTestId('history-item').first()).toContainText('COUNT(*)');

	await reloadReady(page);
	await expect(page.getByTestId('console')).toBeVisible();
	await page.keyboard.press('ControlOrMeta+Alt+KeyC');
	await expect(page.getByTestId('console')).toHaveCount(0);
});

test('the chart dialog draws a bar chart of a result and exports it', async ({ page }) => {
	await gotoReady(page, sqlUrl);
	await runQuery(page, 'SELECT title, price FROM books');
	await page.getByRole('button', { name: 'Display chart' }).click();

	const dialog = page.getByTestId('chart-dialog');
	const svg = dialog.locator('svg[data-chart-type="bar"]');
	await expect(svg).toBeVisible();
	await expect(svg.locator('[data-shape="rect"]')).toHaveCount(3);
	await expect(svg.locator('[data-shape="rect"]').first()).toHaveAttribute(
		'aria-label',
		'Dune - price: 10.5'
	);

	await dialog.getByLabel('Title').fill('Prices');
	await expect(dialog.getByTestId('chart-title')).toHaveText('Prices');
	await dialog.getByLabel('Chart type').selectOption('pie');
	await expect(dialog.locator('[data-shape="slice"]')).toHaveCount(3);
	await dialog.getByLabel('Chart type').selectOption('line');
	await expect(dialog.locator('[data-shape="point"]')).toHaveCount(3);

	const svgDownload = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'SVG' }).click();
	expect((await svgDownload).suggestedFilename()).toBe('Prices.svg');
	const pngDownload = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'PNG' }).click();
	expect((await pngDownload).suggestedFilename()).toBe('Prices.png');
});

test('a result can be turned into a view', async ({ page }) => {
	await gotoReady(page, sqlUrl);
	await runQuery(page, 'SELECT id, title FROM books');
	await page.getByRole('button', { name: 'Create view' }).click();

	const dialog = page.getByTestId('create-view-dialog');
	await expect(dialog.getByTestId('create-view-sql')).toContainText(
		'AS SELECT id, title FROM books'
	);
	await dialog.getByLabel('VIEW name').fill('v_books');
	await dialog.getByLabel('Column names').fill('book_id, book_title');
	await expect(dialog.getByTestId('create-view-sql')).toContainText(
		'CREATE ALGORITHM = UNDEFINED VIEW `v_books` (`book_id`, `book_title`) AS SELECT id, title FROM books'
	);
	await dialog.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(dialog).toHaveCount(0);

	const cols = await withRoot(async (c) => {
		const [rows] = await c.query(
			'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
			[DB, 'v_books']
		);
		return (rows as { t: string; c: string }[]).map((r) => r.c);
	});
	expect(cols).toEqual(['book_id', 'book_title']);

	// a failing CREATE keeps the dialog open with the server error
	await page.getByRole('button', { name: 'Create view' }).click();
	await dialog.getByLabel('VIEW name').fill('v_books');
	await dialog.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('already exists');
});
