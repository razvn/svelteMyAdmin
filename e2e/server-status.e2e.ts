import { expect, test, type Page } from '@playwright/test';
import { createConnection, type Connection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

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

const subnav = (page: Page) => page.getByTestId('status-subnav');

test('status page shows uptime, traffic and connections with sub navigation', async ({ page }) => {
	await gotoReady(page, '/server/status');
	await expect(page.getByTestId('uptime')).toContainText('has been running for');
	await expect(page.getByTestId('traffic-table')).toContainText('Received');
	await expect(page.getByTestId('traffic-table')).toContainText('Sent');
	await expect(page.getByTestId('connections-table')).toContainText('Max. concurrent connections');
	await expect(page.getByTestId('connections-table')).toContainText('Failed attempts');
	// the # column never uses a sub-unit SI prefix such as "9,000 m"; above 4 digits phpMyAdmin
	// switches to k/M (e.g. "12 k"), which this test must accept
	for (const label of ['Failed attempts', 'Aborted', 'Total']) {
		const count = page
			.getByTestId('connections-table')
			.getByRole('row')
			.filter({ hasText: label })
			.getByRole('cell')
			.nth(1);
		await expect(count).toHaveText(/^[\d,.]+( [kMGT])?$/);
	}
	for (const label of [
		'Server',
		'Processes',
		'Query statistics',
		'All status variables',
		'Monitor',
		'Advisor'
	]) {
		await expect(subnav(page).getByRole('link', { name: label, exact: true })).toBeVisible();
	}
	await subnav(page).getByRole('link', { name: 'Monitor' }).click();
	await expect(page.getByTestId('monitor')).toBeVisible();
	await subnav(page).getByRole('link', { name: 'Advisor' }).click();
	await expect(page.getByTestId('advisor')).toBeVisible();
});

test('query statistics', async ({ page }) => {
	await gotoReady(page, '/server/status/queries');
	await expect(page.getByTestId('questions')).toContainText('Questions since startup');
	await expect(page.getByTestId('queries-table')).toContainText('show status');
	await expect(page.getByTestId('queries-chart')).toBeVisible();
});

test('status variables filter, category and alerts', async ({ page }) => {
	await gotoReady(page, '/server/status/variables');
	const table = page.getByTestId('variables-table');
	await expect(table.locator('[data-variable="Uptime"]')).toBeVisible();
	await page.getByLabel('Containing the word').fill('bytes received');
	await expect(table.locator('[data-variable="Bytes_received"]')).toBeVisible();
	await expect(table.locator('[data-variable="Uptime"]')).toHaveCount(0);
	await page.getByLabel('Containing the word').fill('');
	await page.getByTestId('category').click();
	await page.getByRole('option', { name: 'Joins' }).click();
	await expect(table.locator('[data-variable="Select_scan"]')).toBeVisible();
	await expect(table.locator('[data-variable="Uptime"]')).toHaveCount(0);
	await page.getByTestId('category').click();
	await page.getByRole('option', { name: 'All', exact: true }).click();
	await page.getByLabel('Show only alert values').click();
	await expect(table.locator('[data-variable="Uptime"]')).toHaveCount(0);
});

test('processes: filter, kill dialog and kill of a sleeping connection', async ({ page }) => {
	const victim: Connection = await createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root'
	});
	try {
		const [rows] = await victim.query('SELECT CONNECTION_ID() AS id');
		const id = Number((rows as { id: number }[])[0].id);

		await gotoReady(page, '/server/status/processes');
		const row = page.locator(`[data-process-id="${id}"]`);
		await expect(row).toContainText('Sleep');
		await page.getByLabel('Show only active').click();
		await expect(row).toHaveCount(0);
		await page.getByLabel('Show only active').click();
		await expect(row).toBeVisible();

		await row.getByRole('button', { name: 'Kill' }).click();
		const dialog = page.getByTestId('kill-dialog');
		await expect(dialog).toContainText(`KILL ${id}`);
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toBeHidden();
		await expect(row).toBeVisible();

		await row.getByRole('button', { name: 'Kill' }).click();
		await page.getByTestId('kill-confirm').click();
		await expect(page.getByTestId('kill-ok')).toContainText(`Thread ${id} was killed`);
		await expect(page.locator(`[data-process-id="${id}"]`)).toHaveCount(0);
	} finally {
		await victim.end().catch(() => {});
	}
});

test('replication page', async ({ page }) => {
	await gotoReady(page, '/server/replication');
	await expect(page.getByTestId('primary-status')).toBeVisible();
	await expect(page.getByTestId('replica-status')).toContainText('not configured as replica');
});

test('binary log tab and events', async ({ page }) => {
	await gotoReady(page, '/server/replication');
	await expect(page.locator('[data-tab="binlog"]')).toBeVisible();
	await page.locator('[data-tab="binlog"]').click();
	await expect(page).toHaveURL(/\/server\/binlog$/);
	await expect(page.getByTestId('binlog-file')).toContainText('binlog');
	await expect(page.getByTestId('binlog-table')).toContainText('Format_desc');
	await page.getByRole('button', { name: 'Show full queries' }).click();
	await expect(page).toHaveURL(/full=1/);
	await expect(page.getByRole('button', { name: 'Truncate shown queries' })).toBeVisible();
});
