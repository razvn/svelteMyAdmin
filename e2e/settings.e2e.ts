import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady } from './helpers.ts';

// A dedicated MySQL user: preferences are stored per username, so other (parallel) specs that log in
// as root never see the values changed here.
const USER = 'tmp_t8b_u';
const PASSWORD = 'T8b-Pass-1!';
const DB = 'tmp_t8b_e2e';

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
		await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
		await c.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER]);
	});

let dbUp = false;
test.beforeAll(async () => {
	try {
		await cleanup();
		await withRoot(async (c) => {
			await c.query(`CREATE USER '${USER}'@'%' IDENTIFIED BY '${PASSWORD}'`);
			await c.query(`CREATE DATABASE \`${DB}\``);
			await c.query(
				`CREATE TABLE \`${DB}\`.\`notes\` (id int NOT NULL PRIMARY KEY, title varchar(60))`
			);
			const values = Array.from({ length: 40 }, (_, i) => `(${i + 1}, 'note ${i + 1}')`);
			await c.query(`INSERT INTO \`${DB}\`.\`notes\` VALUES ${values.join(',')}`);
			await c.query(`GRANT ALL ON \`${DB}\`.* TO '${USER}'@'%'`);
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

const main = (page: Page) => page.getByRole('main');

test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await withRoot((c) =>
		c.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
	);
	await gotoReady(page, '/login');
	await page.getByLabel('Username').fill(USER);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
});

async function apply(page: Page) {
	await main(page).getByTestId('prefs-apply').click();
	await expect(main(page).getByTestId('settings-saved')).toBeVisible();
}

test('preferences take effect: rows per page, default table tab, export format, statistics', async ({
	page
}) => {
	// Main panel: MaxRows, DefaultTabTable, ShowStats
	await gotoReady(page, '/server/settings/main');
	const rows = main(page).getByTestId('field-MaxRows');
	await rows.locator('input').fill('10');
	await expect(rows.getByTestId('badge-MaxRows')).toBeVisible();
	await expect(rows).toHaveAttribute('data-dirty', 'true');
	await main(page).getByTestId('field-DefaultTabTable').locator('select').selectOption('sql');
	await main(page).getByTestId('field-ShowStats').getByRole('checkbox').click();
	await apply(page);
	await expect(rows.getByTestId('badge-MaxRows')).toBeVisible();
	await expect(rows).toHaveAttribute('data-dirty', 'false');

	// Browse shows 10 rows per page
	await gotoReady(page, `/db/${DB}/table/notes/browse`);
	await expect(main(page).getByTestId('rows-message')).toContainText('Showing rows 0 - 9');
	await expect(main(page).getByTestId('rows-message')).toContainText('40 total');

	// the table opens in the preferred tab
	await gotoReady(page, `/db/${DB}/table/notes`);
	await expect(page).toHaveURL(new RegExp(`/db/${DB}/table/notes/sql$`));

	// statistics are hidden in the database structure
	await gotoReady(page, `/db/${DB}/structure`);
	await expect(main(page).getByTestId('stat-tables')).toBeVisible();
	await expect(main(page).getByTestId('stat-size')).toHaveCount(0);

	// Export format
	await gotoReady(page, '/server/settings/export');
	await main(page).getByTestId('field-Export/format').locator('select').selectOption('csv');
	await apply(page);
	await gotoReady(page, '/server/export');
	await expect(main(page).getByLabel('File format to export')).toHaveValue('csv');

	// Features: console starts expanded
	await gotoReady(page, '/server/settings/features');
	await main(page).getByTestId('field-Console/Mode').locator('select').selectOption('show');
	await apply(page);
	await gotoReady(page, '/server');
	await expect(page.getByTestId('console')).toBeVisible();

	// Navigation panel: grouping off
	await gotoReady(page, '/server/settings/navigation');
	await main(page).getByTestId('field-NavigationTreeEnableGrouping').getByRole('checkbox').click();
	await apply(page);
	await expect(
		main(page)
			.getByTestId('field-NavigationTreeEnableGrouping')
			.getByTestId('badge-NavigationTreeEnableGrouping')
	).toBeVisible();

	// "Restore default value" brings the server value back and clears the badge
	await gotoReady(page, '/server/settings/main');
	await main(page).getByTestId('restore-MaxRows').click();
	await expect(rows.locator('input')).toHaveValue('25');
	await expect(rows.getByTestId('badge-MaxRows')).toHaveCount(0);
	await apply(page);
	await gotoReady(page, `/db/${DB}/table/notes/browse`);
	await expect(main(page).getByTestId('rows-message')).toContainText('Showing rows 0 - 24');
});

test('export the settings as JSON, reset everything and import them back', async ({ page }) => {
	await gotoReady(page, '/server/settings/main');
	await main(page).getByTestId('field-MaxRows').locator('input').fill('15');
	await main(page).getByTestId('field-TabsMode').locator('select').selectOption('text');
	await apply(page);

	await gotoReady(page, '/server/settings');
	await expect(main(page).getByTestId('settings-count')).toContainText('2 customised settings');

	// export (phpMyAdmin's flat format)
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		main(page).getByTestId('export-json').click()
	]);
	expect(download.suggestedFilename()).toMatch(/^phpMyAdmin-config-.*\.json$/);
	const path = await download.path();
	const text = await readFile(path, 'utf8');
	expect(JSON.parse(text)).toEqual({ MaxRows: 15, TabsMode: 'text' });

	// reset
	await main(page).getByTestId('reset-all').click();
	await page.getByTestId('reset-confirm').click();
	await expect(main(page).getByTestId('settings-saved')).toContainText('reset');
	await expect(main(page).getByTestId('settings-count')).toContainText('0 customised settings');
	await gotoReady(page, '/server/settings/main');
	await expect(main(page).getByTestId('field-MaxRows').locator('input')).toHaveValue('25');

	// import restores
	await gotoReady(page, '/server/settings');
	await main(page)
		.locator('input[name="import_file"]')
		.setInputFiles({
			name: 'settings.json',
			mimeType: 'application/json',
			buffer: Buffer.from(text)
		});
	await main(page).getByTestId('import-submit').click();
	await expect(main(page).getByTestId('settings-saved')).toContainText('imported');
	await expect(main(page).getByTestId('settings-count')).toContainText('2 customised settings');
	await gotoReady(page, '/server/settings/main');
	await expect(main(page).getByTestId('field-MaxRows').locator('input')).toHaveValue('15');

	// the row in the shared storage has phpMyAdmin's flat JSON
	const stored = await withRoot(async (c) => {
		const [rows] = await c.query(
			'SELECT config_data FROM phpmyadmin.pma__userconfig WHERE username = ?',
			[USER]
		);
		return JSON.parse((rows as { config_data: string }[])[0].config_data);
	});
	expect(stored).toEqual({ MaxRows: 15, TabsMode: 'text' });

	// merge import keeps the other keys
	await gotoReady(page, '/server/settings');
	await main(page)
		.locator('input[name="import_file"]')
		.setInputFiles({
			name: 'more.json',
			mimeType: 'application/json',
			buffer: Buffer.from('{"ShowStats": false, "LoginCookieValidity": 99}')
		});
	await main(page).getByTestId('import-merge').check();
	await main(page).getByTestId('import-submit').click();
	await expect(main(page).getByTestId('settings-dropped')).toContainText('LoginCookieValidity');
	await expect(main(page).getByTestId('settings-count')).toContainText('3 customised settings');
});

test('invalid values are rejected and a disallowed key is not offered', async ({ page }) => {
	await gotoReady(page, '/server/settings/main');
	await main(page).getByTestId('field-MaxRows').locator('input').fill('0');
	await main(page).getByTestId('prefs-apply').click();
	await expect(main(page).getByTestId('prefs-errors')).toBeVisible();
	await expect(main(page).getByTestId('field-MaxRows')).toContainText('Must be at least 1');
	// LoginCookieValidity is not user-settable
	await gotoReady(page, '/server/settings/features');
	await expect(main(page).getByTestId('field-LoginCookieValidity')).toHaveCount(0);
});

test('without a configuration storage the settings are kept in a cookie', async ({ browser }) => {
	// server 2 (MariaDB) has no pmadb in config.sample.json
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	try {
		await gotoReady(page, '/login?server=2');
		await page.getByLabel('Username').fill('root');
		await page.getByLabel('Password').fill('root');
		await page.getByRole('button', { name: 'Log in' }).click();
		await expect(page).toHaveURL(/\/$/);
		await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');

		await gotoReady(page, '/server/settings/main');
		await main(page).getByTestId('field-MaxRows').locator('input').fill('10');
		await apply(page);

		await gotoReady(page, '/server/settings');
		await expect(main(page).getByTestId('settings-count')).toContainText('1 customised setting');
		await expect(main(page).getByText('In a browser cookie')).toBeVisible();
		const cookies = await ctx.cookies();
		expect(cookies.some((c) => c.name === 'sma_userprefs')).toBe(true);

		// reset removes it again
		await main(page).getByTestId('reset-all').click();
		await page.getByTestId('reset-confirm').click();
		await expect(main(page).getByTestId('settings-count')).toContainText('0 customised settings');
		expect((await ctx.cookies()).some((c) => c.name === 'sma_userprefs')).toBe(false);
	} finally {
		await ctx.close();
	}
});
