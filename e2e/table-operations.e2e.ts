import { expect, test, type Locator, type Page } from '@playwright/test';
import { createConnection, type Connection } from 'mysql2/promise';

const DB = 'tmp_t4d_e2e';
const DB_B = 'tmp_t4d_e2e_b';
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

async function cleanup() {
	const c = await connect();
	await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
	await c.query(`DROP DATABASE IF EXISTS \`${DB_B}\``);
	await c.end();
}

test.beforeAll(async () => {
	try {
		await cleanup();
		const c = await connect();
		await c.query(`CREATE DATABASE \`${DB}\``);
		await c.query(`CREATE DATABASE \`${DB_B}\``);
		await c.query(
			`CREATE TABLE \`${DB}\`.t_orig (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(20)) ENGINE=InnoDB`
		);
		await c.query(`INSERT INTO \`${DB}\`.t_orig (v) VALUES ('a'), ('b'), ('c')`);
		await c.end();
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

/** First column of the first row (COUNT(*) comes back as a string or number). */
async function scalar(sql: string): Promise<string | undefined> {
	const c = await connect();
	try {
		const [rows] = await c.query(sql);
		const row = (rows as Record<string, unknown>[])[0];
		return row ? String(Object.values(row)[0]) : undefined;
	} finally {
		await c.end();
	}
}

/** Open a select and choose an option; retried because a click before hydration is lost. */
async function pick(page: Page, trigger: Locator, option: string) {
	const item = page.getByRole('option', { name: option, exact: true });
	await expect(async () => {
		await trigger.click();
		await expect(item).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 20000 });
	await item.click();
}

const info = (col: string, table: string) =>
	`SELECT ${col} FROM information_schema.TABLES WHERE TABLE_SCHEMA='${DB}' AND TABLE_NAME='${table}'`;

test('rename, change comment and engine, copy, truncate and drop a table', async ({ page }) => {
	const main = page.getByRole('main');
	await page.goto(`/db/${DB}/table/t_orig/operations`);
	await expect(main.getByRole('heading', { name: 'Operations' })).toBeVisible();

	// rename + comment + engine in one go, with a live SQL preview
	const options = main.getByTestId('options-form');
	await options.getByLabel('Rename table to').fill('t_renamed');
	await options.getByLabel('Table comments').fill('hello e2e');
	await pick(page, options.getByRole('combobox', { name: 'Storage engine' }), 'MyISAM');
	const preview = options.getByTestId('options-preview');
	await expect(preview).toContainText('RENAME TABLE');
	await expect(preview).toContainText("COMMENT = 'hello e2e'");
	await expect(preview).toContainText('ENGINE = `MyISAM`');
	await options.getByRole('button', { name: 'Go' }).click();
	await expect(page).toHaveURL(new RegExp(`/db/${DB}/table/t_renamed/operations`));
	await expect(main.getByTestId('outcome')).toContainText('has been updated');
	expect(await scalar(info('TABLE_COMMENT', 't_renamed'))).toBe('hello e2e');
	expect(await scalar(info('ENGINE', 't_renamed'))).toBe('MyISAM');

	// copy structure and data to the other database
	const copy = main.getByTestId('copy-form');
	await pick(page, copy.getByRole('combobox', { name: 'Database' }), DB_B);
	await copy.getByLabel('Copy to table name').fill('t_copy');
	await copy.getByRole('button', { name: 'Go' }).click();
	await expect(main.getByTestId('outcome')).toContainText(`copied to ${DB_B}.t_copy`);
	expect(await scalar(`SELECT COUNT(*) FROM \`${DB_B}\`.t_copy`)).toBe('3');

	// maintenance shows the result dialog
	await main.getByTestId('maintenance').getByRole('button', { name: 'Checksum table' }).click();
	const results = page.getByTestId('results-dialog');
	await expect(results.getByTestId('maintenance-result')).toBeVisible();
	await results.getByRole('button', { name: 'Close' }).first().click();
	await expect(results).toBeHidden();

	// truncate with confirmation
	await main.getByTestId('empty-table').click();
	const confirm = page.getByTestId('confirm-dialog');
	await expect(confirm.getByTestId('confirm-sql')).toContainText(
		`TRUNCATE TABLE \`${DB}\`.\`t_renamed\``
	);
	await confirm.getByRole('button', { name: 'Yes' }).click();
	await expect(main.getByTestId('outcome')).toContainText('has been emptied');
	expect(await scalar(`SELECT COUNT(*) FROM \`${DB}\`.t_renamed`)).toBe('0');

	// drop: back to the database structure
	await main.getByTestId('drop-table').click();
	await expect(confirm.getByTestId('confirm-sql')).toContainText(
		`DROP TABLE \`${DB}\`.\`t_renamed\``
	);
	await confirm.getByRole('button', { name: 'Yes' }).click();
	await expect(page).toHaveURL(new RegExp(`/db/${DB}/structure`));
	expect(await scalar(info('COUNT(*)', 't_renamed'))).toBe('0');
});
