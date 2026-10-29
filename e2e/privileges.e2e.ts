import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const USER = 'tmp_t7a_e2e';
const PW_USER = 'tmp_t7a_e2epw';

async function sql(statements: string[]) {
	const c = await createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root'
	});
	try {
		for (const s of statements) await c.query(s);
	} finally {
		await c.end();
	}
}
const cleanup = () =>
	sql([`DROP USER IF EXISTS '${USER}'@'%'`, `DROP USER IF EXISTS '${PW_USER}'@'%'`]);

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
test('add, list, edit, export and drop a user account', async ({ page }) => {
	await login(page);
	await gotoReady(page, '/server/privileges');
	await expect(main(page).getByRole('heading', { level: 1, name: 'User accounts' })).toBeVisible();
	await main(page).getByTestId('add-user').click();
	await expect(page).toHaveURL(/\/server\/privileges\/add/);

	await main(page).getByRole('textbox', { name: 'User name' }).fill(USER);
	await main(page).getByLabel('Enter password').fill('E2e-Pass-1!');
	await main(page).getByLabel('Re-type').fill('E2e-Pass-1!');
	await main(page).getByRole('checkbox', { name: 'SELECT', exact: true }).click();
	await main(page).getByRole('checkbox', { name: 'INSERT', exact: true }).click();
	await main(page).getByTestId('add-user-go').click();
	await expect(main(page).getByTestId('user-added')).toBeVisible();
	await expect(main(page).getByTestId('statement-list')).toContainText(`CREATE USER '${USER}'@'%'`);
	await expect(main(page).getByTestId('statement-list')).not.toContainText('E2e-Pass-1');
	await expect(main(page).getByTestId('statement-list')).toContainText(
		'GRANT SELECT, INSERT ON *.*'
	);

	await gotoReady(page, '/server/privileges');
	const row = main(page).locator(`tr[data-user="${USER}"]`);
	await expect(row).toBeVisible();
	await expect(row.getByTestId('global-privileges')).toHaveText('SELECT, INSERT');
	await expect(row).toContainText('Yes');

	// edit: add UPDATE
	await row.getByRole('link', { name: /Edit privileges of/ }).click();
	await expect(page).toHaveURL(/\/server\/privileges\/edit\?username=tmp_t7a_e2e/);
	await expect(main(page).getByRole('checkbox', { name: 'SELECT', exact: true })).toBeChecked();
	await expect(main(page).getByRole('checkbox', { name: 'UPDATE', exact: true })).not.toBeChecked();
	await main(page).getByRole('checkbox', { name: 'UPDATE', exact: true }).click();
	await main(page).getByTestId('save-privileges').click();
	await expect(main(page).getByTestId('privileges-saved')).toBeVisible();
	await expect(main(page).getByTestId('statement-list')).toContainText(
		`GRANT UPDATE ON *.* TO '${USER}'@'%'`
	);

	// export
	await gotoReady(page, '/server/privileges');
	await main(page)
		.locator(`tr[data-user="${USER}"]`)
		.getByRole('button', { name: /^Export/ })
		.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByTestId('export-text')).toHaveValue(
		/GRANT SELECT, INSERT, UPDATE ON \*\.\* TO `tmp_t7a_e2e`@`%`;/
	);
	await dialog.getByRole('button', { name: 'Close' }).first().click();

	// drop
	await gotoReady(page, '/server/privileges');
	await main(page)
		.getByRole('checkbox', { name: `Select ${USER}@%` })
		.click();
	await main(page).getByTestId('remove-selected').click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Drop' }).click();
	await expect(main(page).getByTestId('statement-list')).toContainText(`DROP USER '${USER}'@'%'`);
	await expect(main(page).locator(`tr[data-user="${USER}"]`)).toHaveCount(0);
});

test('a user changes their own password and logs in again with the new one', async ({ page }) => {
	await sql([
		`CREATE USER '${PW_USER}'@'%' IDENTIFIED BY 'Old-Pass-1!'`,
		`GRANT SELECT ON *.* TO '${PW_USER}'@'%'`
	]);
	const loginAs = async (password: string) => {
		await gotoReady(page, '/login');
		await page.getByLabel('Username').fill(PW_USER);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Log in' }).click();
		await expect(page).toHaveURL(/\/$/);
	};
	await loginAs('Old-Pass-1!');
	await gotoReady(page, '/server/user-password');
	await main(page).getByLabel('Password', { exact: true }).fill('New-Pass-2!');
	await main(page).getByLabel('Re-type').fill('New-Pass-2!');
	await main(page).getByTestId('change-password-go').click();
	await expect(main(page).getByTestId('password-changed')).toBeVisible();
	await expect(main(page).getByTestId('statement-list')).not.toContainText('New-Pass-2');
	// still logged in (session re-sealed)
	await gotoReady(page, '/server/databases');
	await expect(page).toHaveURL(/\/server\/databases/);

	await page.context().clearCookies();
	await gotoReady(page, '/login');
	await page.getByLabel('Username').fill(PW_USER);
	await page.getByLabel('Password').fill('Old-Pass-1!');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page.getByTestId('login-error')).toBeVisible();
	await loginAs('New-Pass-2!');
});
