import { expect, test, type Page } from '@playwright/test';
import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise';

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
	await page.goto('/login');
	await page.getByLabel('Username').fill('root');
	await page.getByLabel('Password').fill('root');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
});

async function withConnection<T>(fn: (c: Connection) => Promise<T>): Promise<T> {
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

async function globalMaxConnectErrors(): Promise<string> {
	return withConnection(async (c) => {
		const [[row]] = await c.query<RowDataPacket[]>('SELECT @@GLOBAL.max_connect_errors AS v');
		return String(row.v);
	});
}

/** Edit a row through the UI: Edit -> input -> Save. */
async function setVariableInUi(page: Page, name: string, value: string) {
	await page.getByRole('button', { name: `Edit ${name}` }).click();
	await page.getByTestId('variable-input').fill(value);
	await page.getByRole('button', { name: `Save ${name}` }).click();
}

test('variables: filter, byte tooltip and inline edit of a global variable', async ({ page }) => {
	await page.goto('/server/variables');
	await expect(
		page.getByRole('heading', { level: 1, name: 'Server variables and settings' })
	).toBeVisible();
	await expect(page.getByTestId('variables-table')).toBeVisible();

	// the client-side filter is a case-insensitive substring match on the name
	await page.getByTestId('variables-filter').fill('MAX_CONNECT_ERR');
	await expect(page.getByTestId('variable-row')).toHaveCount(1);
	await expect(page.getByTestId('variable-row')).toHaveAttribute(
		'data-variable',
		'max_connect_errors'
	);
	await expect(page.getByTestId('variables-filter')).toHaveValue('MAX_CONNECT_ERR');

	// byte-sized values are formatted and keep the raw value in a tooltip
	await page.getByTestId('variables-filter').fill('key_buffer_size');
	const byteValue = page.getByTestId('byte-value');
	await expect(byteValue).toHaveText(/(B|KiB|MiB|GiB)$/);
	await byteValue.hover();
	// bits-ui renders the tooltip text in an element the trigger describes
	const tooltipId = await byteValue.getAttribute('aria-describedby');
	expect(tooltipId).toBeTruthy();
	await expect(page.locator(`[id="${tooltipId}"]`)).toHaveText(/^\s*\d+\s*$/);

	// inline edit of a harmless global, then restore the original value
	const original = await globalMaxConnectErrors();
	const target = original === '4242' ? '4243' : '4242';
	await page.getByTestId('variables-filter').fill('max_connect_errors');
	try {
		await setVariableInUi(page, 'max_connect_errors', target);
		await expect(page.getByText(`max_connect_errors is now ${target}`)).toBeVisible();
		// integers are shown with thousands separators (4242 -> 4,242)
		await expect(page.getByTestId('variable-row')).toContainText(
			Number(target).toLocaleString('en-US')
		);
		expect(await globalMaxConnectErrors()).toBe(target);
	} finally {
		if ((await globalMaxConnectErrors()) !== original) {
			await page.goto('/server/variables');
			await page.getByTestId('variables-filter').fill('max_connect_errors');
			await setVariableInUi(page, 'max_connect_errors', original);
		}
		await expect
			.poll(globalMaxConnectErrors, { message: 'max_connect_errors restored' })
			.toBe(original);
	}
});

test('variables: the table fits a 1280px window and long values wrap', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/server/variables');
	await expect(page.getByTestId('variables-table')).toBeVisible();
	const value = await page.getByRole('columnheader', { name: 'Value' }).boundingBox();
	expect(value).not.toBeNull();
	expect(value!.x + value!.width).toBeLessThanOrEqual(1280);

	// a long value (optimizer_switch) is clamped and can be expanded
	await page.getByTestId('variables-filter').fill('optimizer_switch');
	const row = page.getByTestId('variable-row');
	await expect(row).toHaveCount(1);
	await expect(row.getByRole('button', { name: 'Show more' })).toBeVisible();
	await row.getByRole('button', { name: 'Show more' }).click();
	await expect(row.getByRole('button', { name: 'Show less' })).toBeVisible();
	const table = await page.getByTestId('variables-table').boundingBox();
	expect(table!.width).toBeLessThanOrEqual(1280);
});

test('variables: a MySQL error is shown in a toast and the edit is cancelled', async ({ page }) => {
	await page.goto('/server/variables');
	await page.getByTestId('variables-filter').fill('version');
	await page.getByRole('button', { name: 'Edit version', exact: true }).click();
	await page.getByTestId('variable-input').fill('x');
	await page.getByRole('button', { name: 'Save version', exact: true }).click();
	await expect(page.getByText(/read only variable/)).toBeVisible();
	await page.getByRole('button', { name: 'Cancel editing version', exact: true }).click();
	await expect(page.getByTestId('variable-input')).toHaveCount(0);
});

test('charsets: charsets with their collations and the server default', async ({ page }) => {
	await page.goto('/server/charsets');
	await expect(
		page.getByRole('heading', { level: 1, name: 'Character sets and collations' })
	).toBeVisible();
	const utf8mb4 = page.locator('[data-charset="utf8mb4"]');
	await expect(utf8mb4).toBeVisible();
	await expect(utf8mb4.locator('[data-collation="utf8mb4_unicode_ci"]')).toBeVisible();
	await expect(page.getByTestId('server-default')).toHaveCount(1);
});

test('engines: list with support badges and the InnoDB detail page', async ({ page }) => {
	await page.goto('/server/engines');
	await expect(page.getByRole('heading', { level: 1, name: 'Storage engines' })).toBeVisible();
	const innodb = page.locator('[data-engine="InnoDB"]');
	await expect(innodb).toContainText('DEFAULT');
	await expect(page.locator('[data-engine="MyISAM"]')).toContainText('YES');

	await innodb.getByRole('link', { name: 'InnoDB' }).click();
	await expect(page).toHaveURL(/\/server\/engines\/InnoDB$/);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('InnoDB');
	await expect(page.getByTestId('engine-variables')).toContainText('innodb_buffer_pool_size');
	await expect(page.getByTestId('innodb-status')).toContainText('BACKGROUND THREAD');
});

test('engines: an unknown engine is a 404', async ({ page }) => {
	const response = await page.goto('/server/engines/NoSuchEngine');
	expect(response?.status()).toBe(404);
});

test('plugins: grouped by type and filterable', async ({ page }) => {
	await page.goto('/server/plugins');
	await expect(page.getByRole('heading', { level: 1, name: 'Plugins' })).toBeVisible();
	await expect(page.locator('[data-type="STORAGE ENGINE"]')).toBeVisible();
	await expect(page.locator('[data-plugin="InnoDB"]')).toBeVisible();

	await page.getByTestId('plugins-filter').fill('innodb');
	await expect(page.getByTestId('plugin-row')).not.toHaveCount(0);
	await expect(page.locator('[data-plugin="mysql_native_password"]')).toHaveCount(0);
});
