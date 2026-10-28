import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createConnection, type Connection } from 'mysql2/promise';
import { signClause } from '../src/lib/server/table/signed-clause.ts';

const DB = 'tmp_t4c_e2e';
const SECRET = (
	JSON.parse(readFileSync(process.env.SMA_CONFIG ?? 'config.sample.json', 'utf8')) as {
		blowfish_secret: string;
	}
).blowfish_secret;
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
	await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
	if (create) {
		await c.query(`CREATE DATABASE \`${DB}\``);
		await c.query(
			`CREATE TABLE \`${DB}\`.parent (id INT PRIMARY KEY, label VARCHAR(20)) ENGINE=InnoDB`
		);
		await c.query(`INSERT INTO \`${DB}\`.parent VALUES (1,'alpha'),(2,'beta')`);
		await c.query(
			`CREATE TABLE \`${DB}\`.items (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(30) NOT NULL, ` +
				`qty INT NOT NULL DEFAULT 0, p_id INT NULL, FOREIGN KEY (p_id) REFERENCES parent(id)) ENGINE=InnoDB`
		);
	}
	await c.end();
}

async function items() {
	const c = await connect();
	const [rows] = await c.query(`SELECT * FROM \`${DB}\`.items ORDER BY id`);
	await c.end();
	return rows as { id: number; name: string; qty: number; p_id: number | null }[];
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
	await page.goto('/login');
	await page.getByLabel('Username').fill('root');
	await page.getByLabel('Password').fill('root');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
});

const insertUrl = '/db/' + DB + '/table/items/insert';
const rowUrl = (id: number, extra = '') => {
	const where = `\`id\` = ${id}`;
	const sig = signClause(SECRET, DB, 'items', where);
	return `${insertUrl}?where=${encodeURIComponent(where)}&sig=${encodeURIComponent(sig)}${extra}`;
};

const go = (page: Page) => page.getByRole('button', { name: 'Go', exact: true }).click();

test.describe.configure({ mode: 'serial' });

test('inserts two rows at once', async ({ page }) => {
	await page.goto(insertUrl);
	const row0 = page.getByTestId('insert-row-0');
	const row1 = page.getByTestId('insert-row-1');
	await expect(row0.getByRole('columnheader', { name: 'Function' })).toBeVisible();
	await row0.getByLabel('Value of name').fill('first');
	await row0.getByLabel('Value of qty').fill('3');
	// the second row is ignored until the user types into it
	await expect(row1.getByRole('checkbox', { name: 'Ignore row 2' })).toBeChecked();
	await row1.getByLabel('Value of name').fill("it's second");
	await expect(row1.getByRole('checkbox', { name: 'Ignore row 2' })).not.toBeChecked();
	await page.getByLabel('After saving').selectOption('new_insert');
	await go(page);
	const result = page.getByTestId('insert-result');
	await expect(result).toContainText('2 rows affected');
	await result.getByRole('button', { name: 'SQL query' }).click();
	await expect(page.getByTestId('insert-sql')).toContainText('INSERT INTO');
	expect(await items()).toMatchObject([
		{ name: 'first', qty: 3, p_id: null },
		{ name: "it's second", qty: 0, p_id: null }
	]);
	// "insert another new row": the form is blank again
	await expect(page.getByTestId('insert-row-0').getByLabel('Value of name')).toHaveValue('');
});

test('edits a row through a signed URL and rejects forged ones', async ({ page }) => {
	const [first] = await items();
	await page.goto(rowUrl(first.id));
	const row = page.getByTestId('insert-row-0');
	await expect(row.getByLabel('Value of name')).toHaveValue('first');
	await row.getByLabel('Value of name').fill('first (edited)');
	await page.getByLabel('Action').selectOption('showinsert');
	await go(page);
	await expect(page.getByTestId('insert-sql')).toContainText('UPDATE');
	expect((await items())[0].name).toBe('first'); // preview only

	await page.getByLabel('Action').selectOption('save');
	await page.getByLabel('After saving').selectOption('same_insert');
	await go(page);
	await expect(page.getByTestId('insert-result')).toContainText('1 row affected');
	await expect(page.getByTestId('insert-row-0').getByLabel('Value of name')).toHaveValue(
		'first (edited)'
	);
	expect((await items())[0].name).toBe('first (edited)');

	const response = await page.goto(`${rowUrl(first.id)}x`);
	expect(response?.status()).toBe(400);
	const unsigned = await page.goto(`${insertUrl}?where=${encodeURIComponent('`id` = 1')}`);
	expect(unsigned?.status()).toBe(400);
});

test('copies a row as a new row', async ({ page }) => {
	const [first] = await items();
	await page.goto(rowUrl(first.id, '&copy=1'));
	const row = page.getByTestId('insert-row-0');
	await expect(row.getByLabel('Value of name')).toHaveValue('first (edited)');
	await expect(row.getByLabel('Value of id')).toHaveValue('');
	await page.getByLabel('After saving').selectOption('new_insert');
	await go(page);
	await expect(page.getByTestId('insert-result')).toContainText('1 row affected');
	const all = await items();
	expect(all).toHaveLength(3);
	expect(all[2]).toMatchObject({ name: 'first (edited)', qty: 3 });
	expect(all[2].id).not.toBe(first.id);
});

test('foreign key dropdown lists the referenced values', async ({ page }) => {
	await page.goto(insertUrl);
	const row = page.getByTestId('insert-row-0');
	await row.getByLabel('Value of name').fill('with parent');
	await row.getByRole('checkbox', { name: 'Null p_id' }).click();
	await row.getByRole('combobox', { name: 'Value of p_id' }).click();
	await expect(page.getByRole('option', { name: 'alpha - 1' })).toBeVisible();
	await expect(page.getByRole('option', { name: 'beta - 2' })).toBeVisible();
	await page.getByPlaceholder('Search referenced values').fill('bet');
	await expect(page.getByRole('option', { name: 'alpha - 1' })).toBeHidden();
	await page.getByRole('option', { name: 'beta - 2' }).click();
	await page.getByLabel('After saving').selectOption('new_insert');
	await go(page);
	await expect(page.getByTestId('insert-result')).toContainText('1 row affected');
	const all = await items();
	expect(all[all.length - 1]).toMatchObject({ name: 'with parent', p_id: 2 });
});
