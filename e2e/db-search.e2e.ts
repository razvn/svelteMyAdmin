import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';

const FIXTURE = 'sma_test';
const DB = 'tmp_t3e_e2e';
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
				`CREATE TABLE \`${DB}\`.\`items\` (id int NOT NULL PRIMARY KEY, name varchar(50) NOT NULL)`
			);
			await c.query(
				`INSERT INTO \`${DB}\`.\`items\` (id, name) VALUES (1, 'apple'), (2, 'apple tart'), (3, 'plum')`
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
	await page.goto('/login');
	await page.getByLabel('Username').fill('root');
	await page.getByLabel('Password').fill('root');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
});

test('search a known author across all tables and see the match counts', async ({ page }) => {
	await page.goto(`/db/${FIXTURE}/search`);
	await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
	// every table is checked before the first submit
	await expect(page.getByRole('checkbox', { name: 'authors', exact: true })).toBeChecked();
	await expect(page.getByRole('checkbox', { name: 'books', exact: true })).toBeChecked();

	await page.getByLabel(/Words or values to search for/).fill('Ursula K. Le Guin');
	// retry the click until it sticks: on a cold load the radio may not be hydrated yet
	const wholeField = page.getByRole('radio', { name: 'the exact phrase as whole field' });
	await expect(async () => {
		await wholeField.click();
		await expect(wholeField).toBeChecked({ timeout: 500 });
	}).toPass();
	await page.getByRole('button', { name: 'Go', exact: true }).click();

	await expect(page).toHaveURL(/criteriaSearchType=4/);
	await expect(page).toHaveURL(/submit_search=Go/);
	const authors = page.getByTestId('search-row-authors');
	await expect(authors).toContainText('1 match in authors');
	await expect(authors.getByRole('link', { name: 'Browse' })).toHaveAttribute(
		'href',
		`/db/${FIXTURE}/table/authors/browse`
	);
	await expect(authors.getByRole('button', { name: 'Delete' })).toBeVisible();

	// a table without matches is listed with no action buttons
	const books = page.getByTestId('search-row-books');
	await expect(books).toContainText('0 matches in books');
	await expect(books.getByRole('link', { name: 'Browse' })).toHaveCount(0);
	await expect(books.getByRole('button', { name: 'Delete' })).toHaveCount(0);

	// the view v_book_authors joins two books to this author, so the total is 1 + 2
	await expect(page.getByTestId('search-row-v_book_authors')).toContainText(
		'2 matches in v_book_authors'
	);
	await expect(page.getByTestId('search-total')).toHaveText('3');
});

test('the results URL is linkable and reproduces the same counts', async ({ page }) => {
	await page.goto(
		`/db/${FIXTURE}/search?criteriaSearchString=Lem&criteriaSearchType=3&criteriaColumnName=name&submit_search=Go&criteriaTables=authors`
	);
	await expect(page.getByTestId('search-row-authors')).toContainText('1 match in authors');
	await expect(page.getByTestId('search-row-authors')).toBeVisible();
	await expect(page.getByRole('checkbox', { name: 'books', exact: true })).not.toBeChecked();
});

test('delete the matching rows after confirming the SQL, only in a tmp_t3e_* scratch db', async ({
	page
}) => {
	await page.goto(
		`/db/${DB}/search?criteriaSearchString=apple&criteriaSearchType=3&submit_search=Go&criteriaTables=items`
	);
	const row = page.getByTestId('search-row-items');
	await expect(row).toContainText('2 matches in items');

	const dialog = page.getByRole('alertdialog');
	// retry the click until the dialog opens: on a cold load the handler may not be hydrated yet
	await expect(async () => {
		await row.getByRole('button', { name: 'Delete' }).click();
		await expect(dialog).toBeVisible({ timeout: 500 });
	}).toPass();
	await expect(page.getByTestId('delete-sql')).toHaveText(
		"DELETE FROM `tmp_t3e_e2e`.`items` WHERE (CONVERT(`id` USING utf8mb4) LIKE '%apple%' OR CONVERT(`name` USING utf8mb4) LIKE '%apple%')"
	);
	await dialog.getByRole('button', { name: 'Delete' }).click();

	await expect(page.getByText('2 rows deleted from items.')).toBeVisible();
	await expect(page.getByTestId('search-row-items')).toContainText('0 matches in items');
	await expect(page.getByTestId('search-total')).toHaveText('0');
});
