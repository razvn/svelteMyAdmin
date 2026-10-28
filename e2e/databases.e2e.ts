import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';

const DB = 'sma_t2a_e2e';
let dbUp = false;

async function cleanup() {
	const c = await createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root',
		connectTimeout: 2000
	});
	await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
	await c.end();
}

test.beforeAll(async () => {
	try {
		await cleanup();
		dbUp = true;
	} catch {
		dbUp = false;
	}
});
test.afterAll(async () => {
	if (dbUp) await cleanup();
});
test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await page.goto('/login');
	await page.getByLabel('Username').fill('root');
	await page.getByLabel('Password').fill('root');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
});

test('create a database, see it in the table and sidebar, drop it in bulk', async ({ page }) => {
	await page.goto('/server/databases');
	await expect(page.getByRole('heading', { name: 'Databases' })).toBeVisible();

	await page.getByLabel('Database name').fill(DB);
	await page.getByRole('button', { name: 'Create' }).click();
	const row = page.getByTestId(`db-row-${DB}`);
	await expect(row).toBeVisible();
	await expect(row.getByRole('link', { name: DB })).toHaveAttribute('href', `/db/${DB}/structure`);
	// sidebar refreshed (grouped under the `sma` prefix when several sma_* databases exist)
	await expect(
		page.getByTestId(`nav-db-${DB}`).or(page.getByTestId('nav-dbgroup-sma'))
	).toBeVisible();

	// system schemas cannot be selected
	await expect(page.getByRole('checkbox', { name: 'Select information_schema' })).toBeDisabled();

	// statistics
	await page.getByRole('link', { name: 'Enable statistics' }).click();
	await expect(page).toHaveURL(/statistics=1/);
	await expect(page.getByRole('columnheader', { name: 'Overhead' })).toBeVisible();
	await expect(page.getByTestId(`db-row-${DB}`)).toContainText('0 B');

	// bulk drop with confirmation
	await page.getByRole('checkbox', { name: `Select ${DB}` }).click();
	await page.getByTestId('bulk-drop').click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog.getByTestId('drop-list')).toContainText(DB);
	await dialog.getByRole('button', { name: 'Drop' }).click();
	await expect(page.getByTestId(`db-row-${DB}`)).toHaveCount(0);
});

test('breadcrumbs keep the database and table visible at 800px', async ({ page }) => {
	await page.setViewportSize({ width: 800, height: 700 });
	await page.goto('/db/sma_test/table/books');
	const crumbs = page.getByRole('navigation', { name: 'breadcrumb' });
	await expect(crumbs.getByRole('link', { name: /sma_test/ })).toBeVisible();
	await expect(crumbs.getByRole('link', { name: /books/ })).toBeVisible();
	const box = await crumbs.getByRole('link', { name: /books/ }).boundingBox();
	expect(box!.height).toBeLessThan(30);
});

test('server tab bar moves overflowing tabs into More at 800px', async ({ page }) => {
	await page.setViewportSize({ width: 800, height: 700 });
	await page.goto('/server/databases');
	const bar = page.getByTestId('tab-bar');
	await expect(bar.getByRole('button', { name: 'More' })).toBeVisible();
	// Measured after layout and fonts settle, so poll: no tab link may extend past the viewport.
	await expect
		.poll(() =>
			page.evaluate(() =>
				Array.from(
					document.querySelectorAll(
						'[data-testid="tab-bar"] nav a, [data-testid="tab-bar"] nav button'
					)
				)
					.filter((el) => el.getBoundingClientRect().right > window.innerWidth)
					.map((el) => el.textContent?.trim())
			)
		)
		.toEqual([]);
});
