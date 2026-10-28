import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';

const COPY = 'sma_t3c_e2e_copy';
const RENAMED = 'sma_t3c_e2e_ren';
let dbUp = false;

async function cleanup() {
	const c = await createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root',
		connectTimeout: 2000
	});
	await c.query(`DROP DATABASE IF EXISTS \`${COPY}\``);
	await c.query(`DROP DATABASE IF EXISTS \`${RENAMED}\``);
	await c.end();
}

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
test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await page.goto('/login');
	await page.getByLabel('Username').fill('root');
	await page.getByLabel('Password').fill('root');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
});

test('copy sma_test, rename the copy, then drop it', async ({ page }) => {
	await page.goto('/db/sma_test/operations');
	await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();

	// copy (structure and data), switch to the copy
	const copyForm = page.getByTestId('copy-form');
	await copyForm.getByLabel('Copy to database name').fill(COPY);
	await copyForm.getByLabel('Switch to copied database').check();
	await copyForm.getByRole('button', { name: 'Go' }).click();
	await expect(page).toHaveURL(new RegExp(`/db/${COPY}/operations`));
	const copied = page.getByTestId('result-copy');
	await expect(copied).toContainText(`Database sma_test has been copied to ${COPY}`);
	await copied.getByText(/SQL \(\d+\)/).click();
	await expect(page.getByTestId('sql-copy')).toContainText(
		`CREATE DATABASE IF NOT EXISTS \`${COPY}\``
	);
	await expect(
		page.getByTestId(`nav-db-${COPY}`).or(page.getByTestId('nav-dbgroup-sma')).first()
	).toBeVisible();

	// rename the copy
	const renameForm = page.getByTestId('rename-form');
	await renameForm.getByLabel('New database name').fill(RENAMED);
	await renameForm.getByRole('button', { name: 'Go' }).click();
	await expect(page).toHaveURL(new RegExp(`/db/${RENAMED}/operations`));
	await expect(page.getByTestId('result-rename')).toContainText(
		`${COPY} has been renamed to ${RENAMED}`
	);

	// the renamed database has the data of the original
	await page.goto(`/db/${RENAMED}/data-dictionary`);
	await expect(page.getByTestId('dd-table-books')).toBeVisible();

	// drop with confirmation
	await page.goto(`/db/${RENAMED}/operations`);
	await page.getByTestId('drop-db').click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toContainText(RENAMED);
	await dialog.getByRole('button', { name: 'Drop' }).click();
	await expect(page).toHaveURL(/\/server\/databases/);
	await expect(page.getByTestId(`db-row-${RENAMED}`)).toHaveCount(0);
	await expect(page.getByTestId(`db-row-${COPY}`)).toHaveCount(0);
});

test('system schemas cannot be changed and an error shows inline', async ({ page }) => {
	await page.goto('/db/information_schema/operations');
	await expect(page.getByText('Operations are not available')).toBeVisible();
	await expect(page.getByTestId('drop-db')).toHaveCount(0);

	await page.goto('/db/sma_test/operations');
	const copyForm = page.getByTestId('copy-form');
	await copyForm.getByLabel('Copy to database name').fill('sma_test');
	await copyForm.getByRole('button', { name: 'Go' }).click();
	await expect(page.getByTestId('result-copy')).toContainText('same name');
});

test('data dictionary lists tables with columns and indexes', async ({ page }) => {
	await page.goto('/db/sma_test/data-dictionary');
	await expect(page.getByRole('heading', { name: 'sma_test' })).toBeVisible();
	const books = page.getByTestId('dd-table-books');
	await expect(books.getByRole('cell', { name: 'title', exact: true }).first()).toBeVisible();
	await expect(books.getByRole('cell', { name: 'varchar(200)' })).toBeVisible();
	await expect(books.getByText('Primary').first()).toBeVisible();
	await expect(books.getByRole('columnheader', { name: 'Keyname' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
});
