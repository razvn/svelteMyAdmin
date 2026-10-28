import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';

const DB = 'tmp_t3d_e2e';
let dbUp = false;

async function withConn<T>(fn: (c: Awaited<ReturnType<typeof createConnection>>) => Promise<T>) {
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
		await withConn(async (c) => {
			await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
			await c.query(`CREATE DATABASE \`${DB}\``);
			await c.query(`CREATE TABLE \`${DB}\`.t (id INT PRIMARY KEY, v INT)`);
			await c.query(
				`CREATE EVENT \`${DB}\`.ev_seed ON SCHEDULE EVERY 1 DAY STARTS '2040-01-01 00:00:00' ` +
					`DISABLE DO DELETE FROM t WHERE id < 0`
			);
		});
		dbUp = true;
	} catch {
		dbUp = false;
	}
});
test.afterAll(async () => {
	if (dbUp) await withConn((c) => c.query(`DROP DATABASE IF EXISTS \`${DB}\``));
});
test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await page.goto('/login');
	await page.getByLabel('Username').fill('root');
	await page.getByLabel('Password').fill('root');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
});

test('create a procedure, execute it, see results, export and drop it', async ({ page }) => {
	await page.goto(`/db/${DB}/routines`);
	await page.waitForLoadState('networkidle'); // hydrated
	await expect(page.getByRole('heading', { name: 'Routines' })).toBeVisible();

	const editor = page.getByTestId('routine-editor');
	// retry the click: it can land before the page hydrated
	await expect(async () => {
		await page.getByTestId('routine-add').click();
		await expect(editor).toBeVisible({ timeout: 1000 });
	}).toPass();
	await editor.getByLabel('Routine name').fill('p_double');
	await editor.getByRole('button', { name: 'Add parameter' }).click();
	await editor.getByLabel('Name of parameter 1').fill('n');
	await editor.getByLabel('Definition').fill('SELECT n * 2 AS doubled');
	await editor.getByTestId('routine-save').click();

	const row = page.locator('[data-testid="routine-row"][data-routine="p_double"]');
	await expect(row).toBeVisible();
	await expect(row.getByText('PROCEDURE')).toBeVisible();

	// execute
	await page.getByRole('button', { name: 'Execute p_double' }).click();
	const exec = page.getByTestId('routine-execute');
	await exec.getByLabel('Value of n').fill('21');
	await exec.getByTestId('routine-run').click();
	await expect(exec.getByTestId('result-set-0')).toContainText('doubled');
	await expect(exec.getByTestId('result-set-0')).toContainText('42');
	await page.keyboard.press('Escape');

	// export
	await page.getByRole('button', { name: 'Export p_double' }).click();
	await expect(page.getByTestId('sql-dialog-text')).toContainText('CREATE');
	await expect(page.getByTestId('sql-dialog-text')).toContainText('p_double');
	await page.keyboard.press('Escape');

	// filter + sidebar link highlight
	await page.getByTestId('routines-filter').fill('nomatch');
	await expect(row).toHaveCount(0);
	await page.getByTestId('routines-filter').fill('double');
	await expect(row).toBeVisible();
	await page.goto(`/db/${DB}/routines?type=PROCEDURE&item=p_double`);
	await expect(page.locator('[data-highlighted-routine="true"]')).toHaveAttribute(
		'data-routine',
		'p_double'
	);

	// drop
	await page.getByRole('button', { name: 'Drop p_double' }).click();
	await page.getByTestId('confirm-drop').getByRole('button', { name: 'Drop', exact: true }).click();
	await expect(row).toHaveCount(0);
});

test('create a trigger from the table Triggers tab, then drop it', async ({ page }) => {
	await page.goto(`/db/${DB}/table/t/triggers`);
	await page.waitForLoadState('networkidle'); // hydrated
	await expect(page.getByRole('heading', { name: 'Triggers' })).toBeVisible();
	const editor = page.getByTestId('trigger-editor');
	await expect(async () => {
		await page.getByTestId('trigger-add').click();
		await expect(editor).toBeVisible({ timeout: 1000 });
	}).toPass();
	await editor.getByLabel('Trigger name').fill('trg_e2e');
	await editor.getByLabel('Definition').fill('SET NEW.v = 5');
	await editor.getByTestId('trigger-save').click();
	const row = page.locator('[data-testid="trigger-row"][data-trigger="trg_e2e"]');
	await expect(row).toBeVisible();
	await expect(row).toContainText('BEFORE');
	await expect(row).toContainText('INSERT');

	// visible at database level too
	await page.goto(`/db/${DB}/triggers`);
	await expect(row).toBeVisible();

	await page.getByRole('button', { name: 'Drop trg_e2e' }).click();
	await page.getByTestId('confirm-drop').getByRole('button', { name: 'Drop', exact: true }).click();
	await expect(row).toHaveCount(0);
});

test('list events and toggle the scheduler (restoring it)', async ({ page }) => {
	const original = await withConn(async (c) => {
		const [r] = (await c.query('SELECT @@global.event_scheduler AS s')) as [
			{ s: string }[],
			unknown
		];
		return r[0].s;
	});
	try {
		await page.goto(`/db/${DB}/events`);
		await page.waitForLoadState('networkidle'); // hydrated
		const row = page.locator('[data-testid="event-row"][data-event="ev_seed"]');
		await expect(row).toBeVisible();
		await expect(row).toContainText('DISABLED');
		await expect(row).toContainText('RECURRING');
		await expect(page.getByTestId('scheduler-state')).toHaveText(original);

		if (original === 'ON' || original === 'OFF') {
			const target = original === 'ON' ? 'OFF' : 'ON';
			await page.getByRole('switch', { name: 'Event scheduler' }).click();
			await expect(page.getByTestId('scheduler-state')).toHaveText(target);
		}
	} finally {
		if (original === 'ON' || original === 'OFF') {
			await withConn((c) => c.query(`SET GLOBAL event_scheduler = ${original}`));
		}
	}
});
