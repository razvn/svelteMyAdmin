import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const DB = 'tmp_t9c_norm_e2e';
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
			await c.query(`CREATE TABLE \`${DB}\`.\`nopk\` (a int NOT NULL, b varchar(10) NOT NULL)`);
			await c.query(`INSERT INTO \`${DB}\`.\`nopk\` VALUES (1,'x'),(2,'y')`);
			await c.query(
				`CREATE TABLE \`${DB}\`.\`orders\` (order_id int NOT NULL, product_id int NOT NULL, qty int NOT NULL, product_name varchar(20) NOT NULL, PRIMARY KEY (order_id, product_id))`
			);
			await c.query(
				`INSERT INTO \`${DB}\`.\`orders\` VALUES (1,1,5,'pen'),(1,2,1,'ink'),(2,1,2,'pen'),(2,3,7,'cap'),(3,2,4,'ink')`
			);
		});
		dbUp = true;
	} catch {
		dbUp = false;
	}
});

test.afterAll(async () => {
	if (dbUp) await withRoot((c) => c.query(`DROP DATABASE IF EXISTS \`${DB}\``));
});

test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await login(page);
});

test('1NF step 1.1 adds a primary key column to a table without one', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/nopk/normalization`);
	const main = page.getByRole('main');
	await main.getByTestId('norm-go').click();
	const step = main.getByTestId('norm-step-1.1');
	await expect(step).toBeVisible();
	await step.getByLabel('Add a new primary key column').check();
	await expect(main.getByTestId('norm-sql')).toContainText('ADD `nopk_id`');
	await expect(main.getByTestId('norm-sql')).toContainText('AUTO_INCREMENT');
	await step.getByTestId('norm-save-pk').click();
	await expect(main.getByTestId('norm-step-1.2')).toBeVisible();

	const pk = await withRoot(async (c) => {
		const [rows] = await c.query(
			`SELECT COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'nopk' AND CONSTRAINT_NAME = 'PRIMARY'`,
			[DB]
		);
		return (rows as { c: string }[]).map((r) => r.c);
	});
	expect(pk).toEqual(['nopk_id']);
});

test('2NF wizard creates a new table from a partial dependency', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/orders/normalization`);
	const main = page.getByRole('main');
	await main.getByLabel('Second step of normalization (1NF+2NF)').check();
	await main.getByTestId('norm-go').click();
	// the table has a primary key: 1.1 is skipped
	await main.getByRole('button', { name: 'No redundant column' }).click();
	await main.getByRole('button', { name: 'No such column' }).click();
	await main.getByRole('button', { name: 'No repeating group' }).click();

	const step = main.getByTestId('norm-step-2.1');
	await expect(step).toBeVisible();
	await step.getByTestId('norm-show-pd').click();
	const found = main.getByTestId('norm-found');
	await expect(found).toContainText('product_id -> product_name');
	await found.getByRole('button', { name: 'Pick' }).click();
	await expect(
		main.getByTestId('dep-orders-product_name').getByRole('checkbox', { name: 'product_id' })
	).toBeChecked();
	await step.getByTestId('norm-next').click();

	const confirm = main.getByTestId('norm-step-2.2');
	await expect(confirm).toBeVisible();
	await confirm.getByLabel('Table name for product_id').fill('products');
	await expect(confirm.getByTestId('norm-sql')).toContainText('CREATE TABLE');
	await expect(confirm.getByTestId('norm-sql')).toContainText('`products`');
	await confirm.getByTestId('norm-apply').click();
	await expect(main.getByTestId('norm-done')).toBeVisible();

	const { rows, cols } = await withRoot(async (c) => {
		const [r] = await c.query(`SELECT * FROM \`${DB}\`.products ORDER BY product_id`);
		const [k] = await c.query(
			`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders' ORDER BY ORDINAL_POSITION`,
			[DB]
		);
		return { rows: r as unknown[], cols: (k as { c: string }[]).map((x) => x.c) };
	});
	expect(rows).toHaveLength(3);
	expect(cols).toEqual(['order_id', 'product_id', 'qty']);
});
