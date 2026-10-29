import { expect, test } from '@playwright/test';
import { createConnection, type Connection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const DB = 'tmp_t8d_e2e';
let dbUp = false;

async function connect(): Promise<Connection> {
	return createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root',
		connectTimeout: 2000
	});
}

async function reset(create: boolean) {
	const c = await connect();
	await c.query(`DELETE FROM phpmyadmin.pma__tracking WHERE db_name = ?`, [DB]);
	await c.query(`DELETE FROM phpmyadmin.pma__central_columns WHERE db_name = ?`, [DB]);
	await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
	if (create) {
		await c.query(`CREATE DATABASE \`${DB}\``);
		await c.query(
			`CREATE TABLE \`${DB}\`.src (code_a INT UNSIGNED NOT NULL, label_b VARCHAR(30) NULL)`
		);
		await c.query(
			`CREATE TABLE \`${DB}\`.tr (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(30) NOT NULL)`
		);
	}
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

test.describe.configure({ mode: 'serial' });

test('adds columns from a table to the central list and uses one in create table', async ({
	page
}) => {
	const main = page.getByRole('main');
	await gotoReady(page, `/db/${DB}/central-columns?from=src`);
	await main.getByRole('checkbox', { name: 'Pick code_a' }).click();
	await main.getByRole('checkbox', { name: 'Pick label_b' }).click();
	await main.getByTestId('central-add-from-table').click();
	await expect(main.getByTestId('central-message')).toContainText('2 column(s) added');
	await expect(main.getByTestId('central-row-code_a')).toContainText('int');
	await expect(main.getByTestId('central-row-label_b')).toContainText('varchar');

	// the stored row follows phpMyAdmin's encoding
	const c = await connect();
	const [rows] = await c.query(
		'SELECT col_type, col_length, col_isNull, col_extra FROM phpmyadmin.pma__central_columns WHERE db_name = ? ORDER BY col_name',
		[DB]
	);
	await c.end();
	expect(rows).toMatchObject([
		{ col_type: 'int', col_isNull: 0, col_extra: ',UNSIGNED' },
		{ col_type: 'varchar', col_length: '30', col_isNull: 1, col_extra: ',' }
	]);

	// use one of them in the create table form
	await gotoReady(page, `/db/${DB}/create-table?name=from_central&num_fields=1`);
	const picker = main.getByLabel('Pick from central columns');
	await expect(picker).toBeVisible();
	await picker.selectOption({ label: 'label_b (varchar)' });
	const col1 = main.getByRole('group', { name: 'Column 1' });
	await expect(col1.getByLabel('Name')).toHaveValue('label_b');
	await expect(col1.getByLabel('Length/Values')).toHaveValue('30');
	await main.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(`/db/${DB}/table/from_central/structure`);

	const d = await connect();
	const [cols] = await d.query(`SHOW COLUMNS FROM \`${DB}\`.from_central`);
	await d.end();
	expect(cols).toMatchObject([{ Field: 'label_b', Type: 'varchar(30)' }]);

	// removing a central column
	await gotoReady(page, `/db/${DB}/central-columns`);
	await main.getByRole('checkbox', { name: 'Select code_a' }).click();
	await main.getByRole('button', { name: 'Delete selected' }).click();
	await expect(main.getByTestId('central-message')).toContainText('1 column(s) removed');
	await expect(main.getByTestId('central-row-code_a')).toHaveCount(0);
});

test('tracks a table: an insert through the Insert page shows in the report', async ({ page }) => {
	const main = page.getByRole('main');
	await gotoReady(page, `/db/${DB}/table/tr/tracking`);
	await main.getByTestId('create-version').click();
	await expect(main.getByTestId('tracking-message')).toContainText('Version 1 was created');
	await expect(main.getByTestId('version-1')).toContainText('active');

	await gotoReady(page, `/db/${DB}/table/tr/insert`);
	await page.getByTestId('insert-row-0').getByLabel('Value of name').fill('tracked-row');
	await page.getByRole('button', { name: 'Go', exact: true }).click();
	// "After saving: go back" (the default) leaves the Insert page, so the result alert is transient:
	// the browse page is the stable proof that the insert succeeded.
	await expect(page).toHaveURL(/\/table\/tr\/browse/);

	await gotoReady(page, `/db/${DB}/table/tr/tracking?report=1&version=1`);
	const report = main.getByTestId('tracking-report');
	await expect(report.getByTestId('log-ddl')).toContainText('CREATE TABLE `tr`');
	await expect(report.getByTestId('log-dml')).toContainText('INSERT INTO');
	await expect(report.getByTestId('log-dml')).toContainText('tracked-row');

	// SQL dump of the report
	await gotoReady(page, `/db/${DB}/table/tr/tracking?report=1&version=1&export=sqldump`);
	await expect(main.getByTestId('report-dump')).toHaveValue(/INSERT INTO[\s\S]*tracked-row/);

	// listed on the database tracking page
	await gotoReady(page, `/db/${DB}/tracking`);
	await expect(main.getByTestId('tracked-tr')).toContainText('active');

	// deactivated: further inserts are not recorded
	await gotoReady(page, `/db/${DB}/table/tr/tracking`);
	await main.getByTestId('version-1').getByRole('button', { name: 'Deactivate' }).click();
	await expect(main.getByTestId('version-1')).toContainText('not active');
	await gotoReady(page, `/db/${DB}/table/tr/insert`);
	await page.getByTestId('insert-row-0').getByLabel('Value of name').fill('untracked-row');
	await page.getByRole('button', { name: 'Go', exact: true }).click();
	// "After saving: go back" (the default) leaves the Insert page, so the result alert is transient:
	// the browse page is the stable proof that the insert succeeded.
	await expect(page).toHaveURL(/\/table\/tr\/browse/);
	await gotoReady(page, `/db/${DB}/table/tr/tracking?report=1&version=1`);
	await expect(main.getByTestId('log-dml')).not.toContainText('untracked-row');
});
