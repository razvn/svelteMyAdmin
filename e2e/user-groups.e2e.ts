import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const GROUP = 'tmp_t7c_g';
const USER = 'tmp_t7c_u';
const PASSWORD = 'T7c-Pass-1!';

async function withRoot<T>(fn: (c: Awaited<ReturnType<typeof createConnection>>) => Promise<T>) {
	const c = await createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root'
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
		await c.query('DELETE FROM phpmyadmin.pma__users WHERE username = ? OR usergroup = ?', [
			USER,
			GROUP
		]);
		await c.query('DELETE FROM phpmyadmin.pma__usergroups WHERE usergroup = ?', [GROUP]);
	});

let dbUp = false;
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
test.beforeEach(() => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
});

const main = (page: Page) => page.getByRole('main');

test('a user group restricts the tabs and routes of its members', async ({ page, browser }) => {
	await withRoot(async (c) => {
		await c.query(`CREATE USER '${USER}'@'%' IDENTIFIED BY '${PASSWORD}'`);
		await c.query(`GRANT SELECT ON sma_test.* TO '${USER}'@'%'`);
	});

	// create the group
	await login(page);
	await gotoReady(page, '/server/privileges');
	await main(page).getByTestId('user-groups-link').click();
	await expect(page).toHaveURL(/\/server\/user-groups$/);
	await main(page).getByTestId('add-group').click();
	await expect(page).toHaveURL(/\?add/);
	await main(page).getByRole('textbox', { name: 'Group name' }).fill(GROUP);
	await main(page).getByTestId('tabs-server').getByLabel('Databases').check();
	await main(page).getByTestId('tabs-server').getByLabel('SQL', { exact: true }).check();
	await main(page).getByTestId('tabs-db').getByLabel('Structure').check();
	await main(page).getByTestId('save-group').click();
	await expect(main(page).getByTestId('group-saved')).toBeVisible();
	const row = main(page).locator(`tr[data-group="${GROUP}"]`);
	await expect(row).toContainText('Databases, SQL');

	// assign it to the user
	await gotoReady(page, '/server/privileges');
	await main(page)
		.locator(`tr[data-user="${USER}"]`)
		.getByRole('button', { name: `Edit user group of ${USER}` })
		.click();
	const dialog = page.getByTestId('group-dialog');
	await dialog.getByLabel('User group').selectOption(GROUP);
	await dialog.getByTestId('group-dialog-go').click();
	await expect(
		main(page).locator(`tr[data-user="${USER}"]`).getByTestId('user-group-cell')
	).toContainText(GROUP);

	// log in as the member
	const ctx = await browser.newContext();
	const member = await ctx.newPage();
	try {
		await gotoReady(member, '/login');
		await member.getByLabel('Username').fill(USER);
		await member.getByLabel('Password').fill(PASSWORD);
		await member.getByRole('button', { name: 'Log in' }).click();
		await expect(member).toHaveURL(/\/$/);

		await gotoReady(member, '/server/databases');
		const serverNav = member.getByRole('navigation', { name: 'Server' });
		await expect(serverNav.getByRole('link', { name: 'Databases' })).toBeVisible();
		await expect(serverNav.getByRole('link', { name: 'SQL', exact: true })).toBeVisible();
		await expect(serverNav.getByRole('link', { name: 'Status' })).toHaveCount(0);
		await expect(serverNav.getByRole('link', { name: 'Variables' })).toHaveCount(0);

		const res = await gotoReady(member, '/server/status');
		expect(res?.status()).toBe(403);
		await expect(
			member.getByText('Your user group does not allow access to this page.')
		).toBeVisible();

		await gotoReady(member, '/db/sma_test/structure');
		const dbNav = member.getByRole('navigation', { name: 'Database' });
		await expect(dbNav.getByRole('link', { name: 'Structure' })).toBeVisible();
		await expect(dbNav.getByRole('link', { name: 'Search' })).toHaveCount(0);
		const res2 = await gotoReady(member, '/db/sma_test/search');
		expect(res2?.status()).toBe(403);
	} finally {
		await ctx.close();
	}

	// deleting the group frees the member
	await gotoReady(page, '/server/user-groups');
	await row.getByRole('button', { name: `Delete ${GROUP}` }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
	await expect(main(page).getByTestId('group-deleted')).toBeVisible();
	await expect(row).toHaveCount(0);
});
