import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';

const DB = 'tmp_t4b_e2e';
let dbUp = false;

async function reset(create: boolean) {
	const c = await createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root',
		connectTimeout: 2000,
		multipleStatements: true
	});
	await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
	if (create) {
		await c.query(`CREATE DATABASE \`${DB}\``);
		await c.query(
			`CREATE TABLE \`${DB}\`.\`orgs\` (\`id\` INT NOT NULL AUTO_INCREMENT, \`title\` VARCHAR(40) NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB;
			 CREATE TABLE \`${DB}\`.\`people\` (
				\`id\` INT NOT NULL AUTO_INCREMENT,
				\`name\` VARCHAR(50) NOT NULL,
				\`email\` VARCHAR(100) NULL,
				\`age\` INT NULL,
				\`org_id\` INT NULL,
				PRIMARY KEY (\`id\`)
			 ) ENGINE=InnoDB;
			 CREATE TABLE \`${DB}\`.\`parts\` (\`id\` INT NOT NULL, \`d\` INT NOT NULL)
				PARTITION BY RANGE (\`id\`) (PARTITION p0 VALUES LESS THAN (10), PARTITION pmax VALUES LESS THAN MAXVALUE);`
		);
	}
	await c.end();
}

test.describe.configure({ mode: 'serial' });

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
	await page.goto('/login');
	await page.getByLabel('Username').fill('root');
	await page.getByLabel('Password').fill('root');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
});

const structure = (table: string) => `/db/${DB}/table/${table}/structure`;
const colNames = async (page: Page) =>
	(await page.getByTestId('columns-table').locator('tbody tr td:nth-child(3)').allInnerTexts()).map(
		(t) => t.trim()
	);

async function choose(
	page: Page,
	scope: ReturnType<Page['locator']>,
	label: string,
	option: string
) {
	await scope.getByRole('combobox', { name: label, exact: true }).click();
	await page.getByRole('option', { name: option, exact: true }).click();
	await expect(page.getByRole('listbox')).toHaveCount(0);
}

test('structure shows columns, indexes, statistics and partitions', async ({ page }) => {
	await page.goto(structure('people'));
	const main = page.getByRole('main');
	await expect(main.getByRole('heading', { name: 'Structure' })).toBeVisible();
	expect(await colNames(page)).toEqual(['id', 'name', 'email', 'age', 'org_id']);
	await expect(main.getByTestId('index-row-PRIMARY')).toBeVisible();
	await expect(main.getByTestId('table-stats')).toContainText('Space usage');
	await expect(main.getByTestId('table-stats')).toContainText('Total');

	await page.goto(structure('parts'));
	const parts = page.getByTestId('partitions-card');
	await expect(parts).toContainText('RANGE(`id`)');
	await expect(parts.getByTestId('partition-p0')).toBeVisible();
	await expect(parts.getByTestId('partition-pmax')).toBeVisible();
});

test('add a column after another one, then make it UNIQUE', async ({ page }) => {
	await page.goto(structure('people'));
	const main = page.getByRole('main');
	const add = main.getByTestId('add-columns');
	await choose(page, add, 'Position of the new columns', 'after');
	await choose(page, add, 'Add after column', 'name');
	await add.getByRole('link', { name: 'Go' }).click();
	await expect(main.getByRole('heading', { name: 'Add columns' })).toBeVisible();

	const row = main.getByRole('group', { name: 'Column 1' });
	await row.getByLabel('Name').fill('nick');
	await choose(page, row, 'Type', 'VARCHAR');
	await row.getByLabel('Length/Values').fill('30');
	await main.getByRole('button', { name: 'Preview SQL' }).click();
	await expect(page.getByTestId('preview-sql')).toContainText('AFTER `name`');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toBeHidden();
	await main.getByRole('button', { name: 'Save' }).click();

	await expect(page).toHaveURL(/\/structure$/);
	await expect(main.getByTestId('column-row-nick')).toBeVisible();
	expect(await colNames(page)).toEqual(['id', 'name', 'nick', 'email', 'age', 'org_id']);

	await main.getByRole('button', { name: 'More actions for nick' }).click();
	await page.getByRole('menuitem', { name: 'Unique', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByTestId('confirm-sql')).toContainText('ADD UNIQUE (`nick`)');
	await dialog.getByRole('button', { name: 'Add' }).click();
	await expect(dialog).toBeHidden();
	await expect(main.getByTestId('index-row-nick')).toContainText('Yes');
});

test('create a composite index with a sub-part', async ({ page }) => {
	await page.goto(structure('people'));
	const main = page.getByRole('main');
	await main.getByLabel('Number of index columns').fill('2');
	await main.getByRole('button', { name: 'Go' }).last().click();
	const dialog = page.getByTestId('index-editor');
	await dialog.getByLabel('Index name').fill('idx_comp');
	await choose(page, dialog.getByRole('group', { name: 'Index column 1' }), 'Column', 'email');
	await dialog
		.getByRole('group', { name: 'Index column 1' })
		.getByLabel('Sub-part size')
		.fill('10');
	await choose(page, dialog.getByRole('group', { name: 'Index column 2' }), 'Column', 'age');
	await expect(dialog.getByTestId('index-sql')).toContainText(
		'INDEX `idx_comp` (`email`(10), `age`)'
	);
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toBeHidden();
	const row = main.getByTestId('index-row-idx_comp');
	await expect(row).toContainText('email (10)');
	await expect(row).toContainText('age');
});

test('add a foreign key with ON DELETE CASCADE', async ({ page }) => {
	await page.goto(`/db/${DB}/table/people/relation`);
	const main = page.getByRole('main');
	await expect(main.getByRole('heading', { name: 'Relation view' })).toBeVisible();
	await main.getByRole('button', { name: 'Add foreign key' }).click();
	const dialog = page.getByTestId('fk-editor');
	await dialog.getByLabel('Constraint name').fill('fk_org');
	await choose(page, dialog, 'Referenced table', 'orgs');
	const pair = dialog.getByRole('group', { name: 'Column pair 1' });
	await choose(page, pair, 'Column', 'org_id');
	await choose(page, pair, 'Referenced column', 'id');
	await choose(page, dialog, 'ON DELETE', 'CASCADE');
	await expect(dialog.getByTestId('fk-sql')).toContainText('ON DELETE CASCADE');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toBeHidden();
	const row = main.getByTestId('fk-row-fk_org');
	await expect(row).toContainText('org_id');
	await expect(row).toContainText(`${DB}.orgs.id`);
	await expect(row).toContainText('CASCADE');
});

test('drop a column after confirming the SQL', async ({ page }) => {
	await page.goto(structure('people'));
	const main = page.getByRole('main');
	await main.getByRole('button', { name: 'Drop age' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByTestId('confirm-sql')).toContainText('DROP `age`');
	await dialog.getByRole('button', { name: 'Drop', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(main.getByTestId('column-row-age')).toHaveCount(0);
	expect(await colNames(page)).toEqual(['id', 'name', 'nick', 'email', 'org_id']);
});

test('change a column keeps its definition', async ({ page }) => {
	await page.goto(structure('people'));
	const main = page.getByRole('main');
	await main.getByRole('link', { name: 'Change email' }).click();
	const row = main.getByRole('group', { name: 'Column 1' });
	await expect(row.getByLabel('Name')).toHaveValue('email');
	await row.getByLabel('Name').fill('mail');
	await main.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(/\/structure$/);
	await expect(main.getByTestId('column-row-mail')).toBeVisible();
	await expect(main.getByTestId('column-row-mail')).toContainText('varchar(100)');
});

test('move columns', async ({ page }) => {
	await page.goto(structure('people'));
	await page.waitForLoadState('networkidle');
	const main = page.getByRole('main');
	await main.getByRole('button', { name: 'Move columns' }).click();
	const dialog = page.getByTestId('move-columns');
	await dialog.getByRole('button', { name: 'Move org_id up' }).click();
	await dialog.getByRole('button', { name: 'Move org_id up' }).click();
	await dialog.getByRole('button', { name: 'Preview SQL' }).click();
	const confirm = page.getByTestId('sql-confirm');
	await expect(confirm.getByTestId('confirm-sql')).toContainText('MODIFY `org_id`');
	await confirm.getByRole('button', { name: 'Move', exact: true }).click();
	await expect(confirm).toBeHidden();
	expect(await colNames(page)).toEqual(['id', 'name', 'org_id', 'nick', 'mail']);
});
