import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
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

test('monitor charts update on every refresh tick, can be added and removed', async ({ page }) => {
	await gotoReady(page, '/server/status/monitor');
	const main = page.getByRole('main');
	const charts = main.getByTestId('monitor-chart');
	await expect(charts).toHaveCount(6);
	await expect(main.getByTestId('monitor-chart-title').first()).toHaveText('Questions (/s)');

	await main.getByTestId('refresh-rate').selectOption('2');
	const questions = main.locator('[data-chart-id="questions"]');
	// The first sample is stored right away, later ones follow the 2 s timer.
	await expect(questions).toHaveAttribute('data-samples', /^[1-9]/);
	const first = Number(await questions.getAttribute('data-samples'));
	await expect
		.poll(async () => Number(await questions.getAttribute('data-samples')))
		.toBeGreaterThan(first);
	// A differential series draws once two samples exist.
	await expect(questions.locator('svg[data-chart-type="line"]')).toBeVisible();

	// Pause stops the polling.
	await main.getByTestId('pause').click();
	await expect(main.getByTestId('paused-note')).toBeVisible();
	await main.getByTestId('pause').click();

	// Add a preset chart, then a custom one.
	await main.getByTestId('add-chart').click();
	const dialog = page.getByTestId('add-chart-dialog');
	await dialog.getByLabel('Preset chart').selectOption('threads');
	await dialog.getByTestId('add-chart-submit').click();
	await expect(charts).toHaveCount(7);
	await expect(main.getByTestId('monitor-chart-title').last()).toHaveText('Threads');

	await main.getByTestId('add-chart').click();
	await dialog.getByLabel('Preset chart').selectOption('custom');
	await dialog.getByLabel('Chart title').fill('Selects');
	await dialog.getByLabel('Status variable').fill('Com_select');
	await dialog.getByTestId('add-variable').click();
	await dialog.getByTestId('add-chart-submit').click();
	await expect(charts).toHaveCount(8);

	// Settings persist across reloads (localStorage).
	await page.reload();
	await expect(main.getByTestId('monitor-chart')).toHaveCount(8);

	// Remove and reset.
	await main.getByRole('button', { name: 'Remove chart Selects' }).click();
	await expect(charts).toHaveCount(7);
	await main.getByTestId('reset-charts').click();
	await expect(charts).toHaveCount(6);
});

test('monitor lays the charts out in the chosen number of columns', async ({ page }) => {
	await gotoReady(page, '/server/status/monitor');
	const main = page.getByRole('main');
	await main.getByTestId('chart-columns').selectOption('2');
	await expect(main.getByTestId('chart-grid')).toHaveClass(/lg:grid-cols-2/);
	await main.getByTestId('reset-charts').click();
});

test('advisor lists fired rules with justification and used variables', async ({ page }) => {
	await gotoReady(page, '/server/status/advisor');
	const main = page.getByRole('main');
	const rules = main.getByTestId('advisor-rule');
	// A fresh test server is always below 1,000 questions or one day of uptime, or logs no slow queries.
	await expect(rules.first()).toBeVisible();
	await expect(main.getByTestId('fired-count')).toContainText('fired');
	await expect(rules.first()).toContainText('Justification');
	await expect(rules.first()).toContainText('Used variables');
	await expect(main.getByTestId('advisor-errors')).toHaveCount(0);
});
