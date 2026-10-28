import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { unzipSync } from 'fflate';
import { gotoReady, login } from './helpers.ts';

const DB = 'tmp_t6a_e2e';
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
			await c.query(
				`CREATE TABLE \`${DB}\`.\`items\` (id int NOT NULL PRIMARY KEY, name varchar(60) NOT NULL)`
			);
			await c.query(`CREATE TABLE \`${DB}\`.\`other\` (id int NOT NULL PRIMARY KEY)`);
			await c.query(`INSERT INTO \`${DB}\`.\`items\` VALUES (1,'alpha'),(2,'beta'),(3,'gamma')`);
			await c.query(`INSERT INTO \`${DB}\`.\`other\` VALUES (1)`);
		});
		dbUp = true;
	} catch {
		dbUp = false;
	}
});

test.afterAll(async () => {
	if (!dbUp) return;
	await withRoot((c) => c.query(`DROP DATABASE IF EXISTS \`${DB}\``));
});

test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL docker not reachable');
	await login(page);
});

const main = (page: import('@playwright/test').Page) => page.getByRole('main');

async function download(page: import('@playwright/test').Page) {
	const [dl] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-submit').click()
	]);
	const path = await dl.path();
	return { name: dl.suggestedFilename(), bytes: readFileSync(path) };
}

test('quick SQL export of sma_test downloads a file with CREATE TABLE books', async ({ page }) => {
	await gotoReady(page, '/db/sma_test/export');
	await expect(main(page).getByTestId('export-form')).toBeVisible();
	const file = await download(page);
	expect(file.name).toBe('sma_test.sql');
	const text = file.bytes.toString('utf8');
	expect(text).toContain('-- svelteMyAdmin SQL Dump');
	expect(text).toContain('CREATE TABLE `books`');
	expect(text).toContain('INSERT INTO `authors`');
});

test('custom export of selected tables with gzip', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/export`);
	await main(page).getByLabel('Custom - display all possible options').click();
	await main(page).getByLabel('Structure of other').click();
	await main(page).getByLabel('Data of other').click();
	await main(page).getByLabel('Compression').selectOption('gzip');
	const file = await download(page);
	expect(file.name).toBe(`${DB}.sql.gz`);
	const text = gunzipSync(file.bytes).toString('utf8');
	expect(text).toContain('CREATE TABLE `items`');
	expect(text).toContain("(2, 'beta')");
	expect(text).not.toContain('`other`');
});

test('zip compression and a custom file name template', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/items/export`);
	await main(page).getByLabel('Custom - display all possible options').click();
	await main(page).getByLabel('File name template').fill('dump-@TABLE@');
	await main(page).getByLabel('Compression').selectOption('zip');
	const file = await download(page);
	expect(file.name).toBe('dump-items.sql.zip');
	const files = unzipSync(new Uint8Array(file.bytes));
	expect(Object.keys(files)).toEqual(['dump-items.sql']);
	expect(Buffer.from(files['dump-items.sql']).toString('utf8')).toContain("'gamma'");
});

test('view the output as text and honour format options', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/items/export`);
	await main(page).getByLabel('Custom - display all possible options').click();
	await main(page).getByLabel('View output as text').click();
	await main(page).getByLabel('Add DROP TABLE / VIEW / PROCEDURE / FUNCTION / EVENT / TRIGGER statement').check();
	await main(page).getByTestId('export-submit').click();
	const out = main(page).getByTestId('export-result');
	await expect(out).toHaveValue(/DROP TABLE IF EXISTS `items`;/);
	await expect(out).toHaveValue(/INSERT INTO `items` \(`id`, `name`\) VALUES\n\(1, 'alpha'\)/);
	// the charset block is only for files
	await expect(out).not.toHaveValue(/SET NAMES/);
});

test('export the rows of a SQL page result', async ({ page }) => {
	const query = `SELECT id, name FROM items WHERE id >= 2 ORDER BY id`;
	await gotoReady(page, `/db/${DB}/export?sql_query=${encodeURIComponent(query)}`);
	await expect(main(page).getByTestId('export-query')).toContainText(query);
	await main(page).getByLabel('Custom - display all possible options').click();
	await main(page).getByLabel('View output as text').click();
	await main(page).getByTestId('export-submit').click();
	const out = main(page).getByTestId('export-result');
	await expect(out).toHaveValue(/\(2, 'beta'\),\n\(3, 'gamma'\);/);
	await expect(out).not.toHaveValue(/alpha/);
});

test('the SQL page result links to the export page', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/items/sql`);
	await page.getByRole('main').getByRole('button', { name: 'Go' }).click();
	await expect(page.getByTestId('statement-result')).toHaveCount(1);
	await page.getByTestId('statement-result').getByRole('link', { name: 'Export' }).click();
	await expect(page).toHaveURL(/\/export\?sql_query=/);
	await expect(main(page).getByTestId('export-query')).toContainText('items');
});

test('save, load and delete an export template', async ({ page }) => {
	const name = `tpl_${Date.now()}`;
	await gotoReady(page, `/db/${DB}/export`);
	await main(page).getByLabel('Custom - display all possible options').click();
	const tpl = main(page).getByTestId('export-templates');
	await expect(tpl).toBeVisible();
	// change an option, save as template
	await main(page).getByLabel('Truncate table before insert').check();
	await tpl.getByPlaceholder('Template name').fill(name);
	await tpl.getByRole('button', { name: 'Create' }).click();
	await expect(tpl.getByLabel('Existing templates')).toContainText(name);
	// reload the page (defaults), then load the template back
	await gotoReady(page, `/db/${DB}/export`);
	await main(page).getByLabel('Custom - display all possible options').click();
	await expect(main(page).getByLabel('Truncate table before insert')).not.toBeChecked();
	const tpl2 = main(page).getByTestId('export-templates');
	await tpl2.getByLabel('Existing templates').selectOption({ label: name });
	await tpl2.getByRole('button', { name: 'Load' }).click();
	await expect(main(page).getByLabel('Truncate table before insert')).toBeChecked();
	await tpl2.getByRole('button', { name: 'Delete' }).click();
	await expect(tpl2.getByLabel('Existing templates')).not.toContainText(name);
});

test('binary formats cannot be viewed as text and download a file', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/items/export`);
	await main(page).getByLabel('Custom - display all possible options').click();
	await main(page).getByLabel('File format to export').selectOption('ods');
	await expect(main(page).getByLabel('View output as text')).toBeDisabled();
	const file = await download(page);
	expect(file.name).toBe('items.ods');
	expect(file.bytes.subarray(0, 2).toString()).toBe('PK');
});

test('browse: exporting selected rows lands preselected and exports only them', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/items/browse`);
	await main(page).getByLabel('Select row 2', { exact: true }).click();
	await page.getByTestId('with-selected').getByRole('link', { name: 'Export' }).click();
	await expect(main(page).getByTestId('export-selected-rows')).toContainText('1 selected row');
	await main(page).getByLabel('Custom - display all possible options').click();
	await main(page).getByLabel('View output as text').click();
	await main(page).getByTestId('export-submit').click();
	const out = main(page).getByTestId('export-result');
	await expect(out).toHaveValue(/\(2, 'beta'\);/);
	await expect(out).not.toHaveValue(/alpha/);
});
