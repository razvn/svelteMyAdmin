import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const DB = 'tmp_t3b_e2e';
let dbUp = false;

async function reset(create: boolean) {
	const c = await createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root',
		connectTimeout: 2000
	});
	await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
	if (create) await c.query(`CREATE DATABASE \`${DB}\``);
	await c.end();
}

test.beforeAll(async () => {
	try {
		await reset(true);
		dbUp = true;
	} catch {
		dbUp = false;
	}
});
test.afterAll(async () => {
	if (dbUp) await reset(false);
});
test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await login(page);
});

async function pick(
	page: import('@playwright/test').Page,
	row: number,
	label: string,
	option: string
) {
	await page
		.getByRole('group', { name: `Column ${row}` })
		.getByRole('combobox', { name: label })
		.click();
	await page.getByRole('option', { name: option, exact: true }).click();
}

test('create a 3-column table through the UI, see it in the sidebar', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/create-table?name=people&num_fields=3`);
	await expect(page.getByRole('heading', { name: 'Create new table' })).toBeVisible();
	await expect(page.getByLabel('Table name')).toHaveValue('people');
	await expect(page.getByRole('group', { name: /^Column \d$/ })).toHaveCount(3);

	const c1 = page.getByRole('group', { name: 'Column 1' });
	await c1.getByLabel('Name').fill('id');
	await c1.getByRole('checkbox', { name: 'A_I' }).click();
	await expect(c1.getByRole('combobox', { name: 'Index' })).toContainText('PRIMARY');

	const c2 = page.getByRole('group', { name: 'Column 2' });
	await c2.getByLabel('Name').fill('name');
	await pick(page, 2, 'Type', 'VARCHAR');
	await c2.getByLabel('Length/Values').fill('80');

	const c3 = page.getByRole('group', { name: 'Column 3' });
	await c3.getByLabel('Name').fill('born');
	await pick(page, 3, 'Type', 'DATE');
	await c3.getByRole('checkbox', { name: 'Null' }).click();

	await page.getByRole('button', { name: 'Preview SQL' }).click();
	const preview = page.getByTestId('preview-sql');
	await expect(preview).toContainText(`CREATE TABLE \`${DB}\`.\`people\``);
	await expect(preview).toContainText('`name` VARCHAR(80) NOT NULL');
	await expect(preview).toContainText('PRIMARY KEY (`id`)');
	await page.keyboard.press('Escape');

	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(`/db/${DB}/table/people/structure`);
	await expect(
		page.getByTestId(`nav-db-${DB}`).getByRole('link', { name: 'people' }).first()
	).toBeVisible();
});

test('a MySQL error is shown inline and the form is kept', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/create-table?name=broken&num_fields=1`);
	const c1 = page.getByRole('group', { name: 'Column 1' });
	await c1.getByLabel('Name').fill('s');
	await pick(page, 1, 'Type', 'VARCHAR'); // no length -> server error
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByTestId('create-error')).toBeVisible();
	await expect(page).toHaveURL(/create-table/);
	await expect(page.getByLabel('Table name')).toHaveValue('broken');
	await expect(c1.getByLabel('Name')).toHaveValue('s');
});
