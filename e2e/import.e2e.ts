import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const DB = 'tmp_t6d_e2e';
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
			await c.query(`CREATE TABLE \`${DB}\`.\`people\` (id int PRIMARY KEY, name varchar(40))`);
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

const upload = (name: string, content: string) => ({
	name,
	mimeType: 'application/octet-stream',
	buffer: Buffer.from(content)
});

test('upload a .sql file at database level: success message and the new table in the sidebar', async ({
	page
}) => {
	await gotoReady(page, `/db/${DB}/import`);
	const main = page.getByRole('main');
	await expect(main.getByRole('heading', { name: 'Import', level: 1 })).toBeVisible();

	const sql = `CREATE TABLE \`imported_books\` (id int PRIMARY KEY, title varchar(40));
INSERT INTO \`imported_books\` VALUES (1, 'Dune; part one'), (2, 'Emma');
INSERT INTO \`imported_books\` VALUES (3, 'Ubik');
`;
	await main.getByTestId('import-file').setInputFiles(upload('books.sql', sql));
	await expect(main.getByTestId('import-file-info')).toContainText('books.sql');
	await expect(main.getByLabel('Format', { exact: true })).toHaveValue('sql');
	await main.getByTestId('import-go').click();

	const result = main.getByTestId('import-result');
	await expect(result.getByTestId('import-message')).toContainText(
		'Import has been successfully finished, 3 queries executed. (books.sql)'
	);
	await expect(
		page.getByTestId(`nav-db-${DB}`).getByRole('link', { name: 'imported_books' })
	).toBeVisible();
	await expect(
		result.getByTestId('import-created').getByRole('link', { name: 'imported_books' })
	).toBeVisible();
});

test('upload a CSV into a table, then browse shows the rows', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/people/import`);
	const main = page.getByRole('main');
	await main
		.getByTestId('import-file')
		.setInputFiles(upload('people.csv', 'id,name\n1,"Ann, A."\n2,Bob\n'));
	await expect(main.getByLabel('Format', { exact: true })).toHaveValue('csv');
	await main.getByLabel('The first line of the file contains the table column names').click();
	await main.getByTestId('import-go').click();
	await expect(main.getByTestId('import-message')).toContainText(
		'Import has been successfully finished, 2 queries executed. (people.csv)'
	);
	await main.getByTestId('import-browse').click();
	await expect(page).toHaveURL(`/db/${DB}/table/people/browse`);
	const grid = page.getByRole('main');
	await expect(grid.getByText('Ann, A.')).toBeVisible();
	await expect(grid.getByText('Bob')).toBeVisible();
});

test('an error file shows the error with its line, and continuing skips the failed query', async ({
	page
}) => {
	await gotoReady(page, `/db/${DB}/import`);
	const main = page.getByRole('main');
	const sql = `CREATE TABLE \`err_t\` (a int PRIMARY KEY);
INSERT INTO \`err_t\` VALUES (1);

INSERT INTO \`err_t\` VALUES (1);
INSERT INTO \`err_t\` VALUES (2);
`;
	await main.getByTestId('import-file').setInputFiles(upload('broken.sql', sql));
	await main.getByTestId('import-go').click();
	const result = main.getByTestId('import-result');
	await expect(result.getByTestId('import-message')).toContainText('Duplicate entry');
	await expect(result.getByTestId('import-error-line')).toContainText('line 4');
	await expect(result.getByTestId('import-error-statement')).toContainText(
		'INSERT INTO `err_t` VALUES (1)'
	);

	await result.getByTestId('import-continue').click();
	await expect(main.getByTestId('import-message')).toContainText(
		'Import has been successfully finished, 1 queries executed. (broken.sql)'
	);
	const rows = await withRoot(async (c) => {
		const [r] = await c.query(`SELECT a FROM \`${DB}\`.err_t ORDER BY a`);
		return (r as { a: number }[]).map((x) => x.a);
	});
	expect(rows).toEqual([1, 2]);
});

test('server level import and the LOAD DATA explanation at table level', async ({ page }) => {
	await gotoReady(page, '/server/import');
	await expect(page.getByRole('main').getByLabel('Format', { exact: true })).toBeVisible();
	await expect(
		page.getByRole('main').getByRole('option', { name: 'CSV using LOAD DATA' })
	).toHaveCount(0);

	await gotoReady(page, `/db/${DB}/table/people/import`);
	await expect(
		page.getByRole('main').getByRole('option', { name: 'CSV using LOAD DATA' })
	).toHaveCount(1);
});
