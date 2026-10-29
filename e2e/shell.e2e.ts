import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login, reloadReady } from './helpers.ts';

let dbUp = false;
test.beforeAll(async () => {
	try {
		const c = await createConnection({
			host: '127.0.0.1',
			port: 33306,
			user: 'root',
			password: 'root',
			connectTimeout: 2000
		});
		await c.end();
		dbUp = true;
	} catch {
		dbUp = false;
	}
});
test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await login(page);
});

async function expandSmaTest(page: Page) {
	// If other `sma_*` databases exist, `sma_test` lives inside the `sma` group: open it first.
	const db = page.getByTestId('nav-db-sma_test');
	const group = page.getByTestId('nav-dbgroup-sma');
	await expect(db.or(group).first()).toBeVisible();
	if (!(await db.isVisible())) await group.getByRole('button').first().click();
	await db.getByRole('button', { name: 'Expand sma_test', exact: true }).click();
}

test('home shows the server version and the web server cards', async ({ page }) => {
	await expect(page.getByRole('heading', { level: 1 })).toContainText('svelteMyAdmin');
	await expect(page.getByTestId('server-version')).toContainText(/\d+\.\d+/);
	await expect(page.getByTestId('server-type')).toHaveText('MySQL');
	await expect(page.getByText('Node.js')).toBeVisible();
	await expect(page.getByTestId('app-version')).toHaveText('0.0.1');
});

test('the connection collation can be changed and is remembered', async ({ page }) => {
	await page.getByTestId('collation-select').click();
	await page.getByRole('option', { name: 'utf8mb4_general_ci', exact: true }).click();
	await page.getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByRole('status')).toContainText('utf8mb4_general_ci');
	await reloadReady(page);
	await expect(page.getByTestId('collation-select')).toHaveText('utf8mb4_general_ci');
});

test('sidebar lists sma_test and lazily loads its children', async ({ page }) => {
	await expect(
		page.getByTestId('nav-db-sma_test').or(page.getByTestId('nav-dbgroup-sma')).first()
	).toBeVisible();
	await expandSmaTest(page);

	const item = page.getByTestId('nav-db-sma_test');
	const tables = item.getByTestId('nav-group-tables');
	await expect(tables.getByRole('link', { name: 'authors', exact: true })).toBeVisible();
	await expect(tables.getByRole('link', { name: 'books', exact: true })).toBeVisible();
	await expect(
		item.getByTestId('nav-group-views').getByRole('link', { name: 'v_book_authors' })
	).toBeVisible();
	await expect(
		item.getByTestId('nav-group-procedures').getByRole('link', { name: 'sp_books_by_author' })
	).toBeVisible();
	await expect(
		item.getByTestId('nav-group-functions').getByRole('link', { name: 'fn_book_count' })
	).toBeVisible();
});

test('clicking a table opens browse with breadcrumbs and the table tab bar', async ({ page }) => {
	await expandSmaTest(page);
	await page
		.getByTestId('nav-db-sma_test')
		.getByTestId('nav-group-tables')
		.getByRole('link', { name: 'books', exact: true })
		.click();
	await expect(page).toHaveURL(/\/db\/sma_test\/table\/books\/browse$/);

	const crumbs = page.getByRole('navigation', { name: 'breadcrumb' });
	await expect(crumbs.getByRole('link', { name: /sma_test/ })).toBeVisible();
	await expect(crumbs.getByRole('link', { name: /books/ })).toBeVisible();

	const tabs = page.getByRole('navigation', { name: 'Table' });
	for (const name of ['Browse', 'Structure', 'SQL', 'Search', 'Insert', 'Operations']) {
		await expect(tabs.getByRole('link', { name })).toBeVisible();
	}
	await expect(tabs.getByRole('link', { name: 'Browse' })).toHaveAttribute('aria-current', 'page');
	// Browse is implemented: the table's rows are listed
	await expect(page.getByTestId('rows-message')).toContainText('Showing rows 0 - 3');
});

test('a view gets the reduced tab set', async ({ page }) => {
	await gotoReady(page, '/db/sma_test/table/v_book_authors');
	await expect(page).toHaveURL(/\/db\/sma_test\/table\/v_book_authors\/browse$/);
	const tabs = page.getByRole('navigation', { name: 'View' });
	await expect(tabs.getByRole('link', { name: 'Browse' })).toBeVisible();
	await expect(tabs.getByRole('link', { name: 'Insert' })).toHaveCount(0);
	await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText('View:');
	const res = await gotoReady(page, '/db/sma_test/table/v_book_authors/insert');
	expect(res?.status()).toBe(404);
});

test('db and server routes: redirect, tab bars, 404', async ({ page }) => {
	await gotoReady(page, '/db/sma_test');
	await expect(page).toHaveURL(/\/db\/sma_test\/structure$/);
	await expect(
		page.getByRole('navigation', { name: 'Database' }).getByRole('link', { name: 'Routines' })
	).toBeVisible();

	await gotoReady(page, '/server/settings');
	await expect(page.getByRole('navigation', { name: 'Server' })).toBeVisible();
	await expect(page.getByTestId('not-implemented')).toContainText('Phase 8');

	const res = await gotoReady(page, '/db/doesnotexist/structure');
	expect(res?.status()).toBe(404);
	await expect(page.getByTestId('error-card')).toContainText('Database not found');
	// the shell stays around the error
	await expect(page.getByRole('link', { name: 'svelteMyAdmin home' })).toBeVisible();

	const missingTable = await gotoReady(page, '/db/sma_test/table/nope/browse');
	expect(missingTable?.status()).toBe(404);
	await expect(page.getByTestId('error-card')).toContainText('Table not found');
});

test('Ctrl+K palette finds a table of the expanded database', async ({ page }) => {
	await expandSmaTest(page);
	await expect(
		page.getByTestId('nav-group-tables').getByRole('link', { name: 'books', exact: true })
	).toBeVisible();
	await page.keyboard.press('Control+k');
	const input = page.getByPlaceholder('Jump to a database, table or page...');
	await expect(input).toBeVisible();
	await input.fill('books');
	const option = page.getByRole('option', { name: /^books/ });
	await expect(option.first()).toBeVisible();
	await option.first().click();
	await expect(page).toHaveURL(/\/db\/sma_test\/table\/books\/browse$/);
});

test('the sidebar can be resized with the keyboard and remembers its width', async ({ page }) => {
	const sep = page.getByRole('separator', { name: 'Resize navigation' });
	const before = Number(await sep.getAttribute('aria-valuenow'));
	await sep.focus();
	await page.keyboard.press('ArrowRight');
	await expect(sep).toHaveAttribute('aria-valuenow', String(before + 16));
	await reloadReady(page);
	await expect(page.getByRole('separator', { name: 'Resize navigation' })).toHaveAttribute(
		'aria-valuenow',
		String(before + 16)
	);
});

test('a rejected password sends the user back to the login with a message', async ({ page }) => {
	const admin = await createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root'
	});
	const user = `sma_e2e_${Date.now() % 100000}`;
	await admin.query(`CREATE USER '${user}'@'%' IDENTIFIED BY 'first-pass'`);
	try {
		await page.context().clearCookies();
		await gotoReady(page, '/login');
		await page.getByLabel('Username').fill(user);
		await page.getByLabel('Password').fill('first-pass');
		await page.getByRole('button', { name: 'Log in' }).click();
		await expect(page).toHaveURL(/\/$/);

		await admin.query(`ALTER USER '${user}'@'%' IDENTIFIED BY 'second-pass'`);
		await gotoReady(page, '/server/databases');
		await expect(page).toHaveURL(/\/login\?expired=1/);
		await expect(page.getByTestId('login-expired')).toContainText('no longer valid');
		// the stale session cookie is gone: protected pages redirect to the login form
		await gotoReady(page, '/');
		await expect(page).toHaveURL(/\/login/);
	} finally {
		await admin.query(`DROP USER '${user}'@'%'`).catch(() => {});
		await admin.end();
	}
});
