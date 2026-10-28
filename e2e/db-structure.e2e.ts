import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';

const DB = 'tmp_t3a_e2e';
let dbUp = false;

async function connect() {
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
	await c.end();
}

async function seed() {
	const c = await connect();
	await c.query(`CREATE DATABASE \`${DB}\``);
	await c.query(`USE \`${DB}\``);
	await c.query('CREATE TABLE a_users (id INT PRIMARY KEY, name VARCHAR(20)) ENGINE=InnoDB');
	await c.query("INSERT INTO a_users VALUES (1,'x'),(2,'y'),(3,'z')");
	await c.query('CREATE TABLE a_posts (id INT PRIMARY KEY) ENGINE=InnoDB COMMENT="all posts"');
	await c.query('CREATE TABLE b_misc (id INT) ENGINE=MyISAM');
	await c.query('CREATE VIEW v_users AS SELECT id FROM a_users');
	await c.end();
}

test.beforeAll(async () => {
	try {
		await cleanup();
		await seed();
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

async function choose(page: Page, label: string) {
	await page.getByTestId('bulk-op').click();
	await page.getByRole('option', { name: label }).click();
}

test('structure lists tables and views, optimize shows the result, prefix, drop with sidebar update', async ({
	page
}) => {
	await page.goto(`/db/${DB}/structure`);
	await expect(page.getByRole('heading', { name: 'Structure' })).toBeVisible();
	await expect(page.getByTestId('stat-tables')).toContainText('4');
	await expect(page.getByTestId('table-count')).toHaveText('4');
	await expect(page.getByTestId('rows-a_users')).toContainText('3');
	await expect(page.getByTestId('table-row-v_users')).toContainText('View');
	await expect(page.getByTestId('table-row-a_posts')).toContainText('all posts');
	await expect(
		page.getByRole('main').getByRole('link', { name: 'a_users', exact: true })
	).toHaveAttribute('href', `/db/${DB}/table/a_users/browse`);

	// filter
	await page.getByLabel('Filter tables').fill('posts');
	await expect(page.getByTestId('table-row-a_users')).toHaveCount(0);
	await page.getByLabel('Filter tables').fill('');

	// optimize -> result table
	await page.getByRole('checkbox', { name: 'Select a_users' }).click();
	await page.getByRole('checkbox', { name: 'Select b_misc' }).click();
	await choose(page, 'Optimize table');
	const results = page.getByTestId('results-dialog');
	await expect(results.getByTestId('maintenance-result')).toContainText(`${DB}.a_users`);
	await expect(results.getByTestId('maintenance-result')).toContainText('optimize');
	await results.getByRole('button', { name: 'Close' }).first().click();
	await expect(results).toHaveCount(0);

	// show create
	await choose(page, 'Show create');
	await expect(page.getByTestId('results-dialog')).toContainText('CREATE TABLE');
	await page.keyboard.press('Escape');

	// add prefix
	await choose(page, 'Add prefix to table');
	await page.getByRole('textbox', { name: 'Prefix' }).fill('p_');
	await page.getByRole('button', { name: 'Continue' }).click();
	const confirm = page.getByRole('alertdialog');
	await expect(confirm.getByTestId('confirm-sql')).toContainText(
		'ALTER TABLE `a_users` RENAME `p_a_users`'
	);
	await confirm.getByRole('button', { name: 'Yes' }).click();
	await expect(page.getByTestId('table-row-p_a_users')).toBeVisible();
	await expect(page.getByTestId('table-row-p_b_misc')).toBeVisible();
	await expect(page.getByTestId('table-row-a_users')).toHaveCount(0);
	// the sidebar tree was reloaded with the new names
	const nav = page.getByTestId(`nav-db-${DB}`);
	await expect(nav.getByRole('link', { name: 'p_a_users' })).toBeVisible();

	// drop selected with confirmation
	await page.getByRole('checkbox', { name: 'Select p_b_misc' }).click();
	await page.getByRole('checkbox', { name: 'Select v_users' }).click();
	await choose(page, 'Drop');
	const dropDialog = page.getByRole('alertdialog');
	await expect(dropDialog.getByTestId('confirm-sql')).toContainText('DROP TABLE `p_b_misc`');
	await expect(dropDialog.getByTestId('confirm-sql')).toContainText('DROP VIEW `v_users`');
	await expect(dropDialog.getByLabel('Enable foreign key checks')).toBeChecked();
	await dropDialog.getByRole('button', { name: 'Yes' }).click();
	await expect(page.getByTestId('table-row-p_b_misc')).toHaveCount(0);
	await expect(page.getByTestId('table-row-v_users')).toHaveCount(0);
	await expect(page.getByTestId('table-count')).toHaveText('2');

	// the sidebar follows (current database is expanded)
	await expect(nav.getByRole('link', { name: 'p_a_users' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'p_b_misc' })).toHaveCount(0);

	// single row drop
	await page.getByRole('button', { name: 'Drop a_posts' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Yes' }).click();
	await expect(page.getByTestId('table-row-a_posts')).toHaveCount(0);
});

test('create new table form links to the create-table page', async ({ page }) => {
	await page.goto(`/db/${DB}/structure`);
	const form = page.locator('form[action$="/create-table"]');
	await form.getByLabel('Table name').fill('t_new');
	await form.getByLabel('Number of columns').fill('3');
	await form.getByRole('button', { name: 'Create' }).click();
	await expect(page).toHaveURL(`/db/${DB}/create-table?name=t_new&num_fields=3`);
});
