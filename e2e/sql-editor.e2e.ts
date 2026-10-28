import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const DB = 'tmp_t5b_e2e';
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
	await login(page);
});

test('type a routine definition in the CodeMirror editor and save it', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/routines`);
	await page.getByTestId('routine-add').click();
	const editor = page.getByTestId('routine-editor');
	await expect(editor).toBeVisible();
	await editor.getByLabel('Routine name').fill('p_cm');
	const cm = editor.locator('.cm-content');
	await expect(cm).toBeVisible();
	await cm.click();
	await page.keyboard.type('SELECT (1 + 2) AS three');
	await expect(cm).toContainText('SELECT (1 + 2) AS three');
	await editor.getByTestId('routine-save').click();
	await expect(editor).toBeHidden();
	await expect(page.locator('[data-testid="routine-row"][data-routine="p_cm"]')).toBeVisible();
	const rows = await withConn(async (c) => {
		const [r] = await c.query(
			'SELECT ROUTINE_DEFINITION AS d FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?',
			[DB, 'p_cm']
		);
		return r as Array<{ d: string }>;
	});
	expect(rows[0].d).toContain('SELECT (1 + 2) AS three');
});

test('schema endpoint lists tables and columns, 404 for unknown db', async ({ page }) => {
	const ok = await page.request.get('/api/sql/schema?db=sma_test');
	expect(ok.status()).toBe(200);
	const body = (await ok.json()) as { tables: Record<string, string[]> };
	expect(Object.keys(body.tables)).toEqual(expect.arrayContaining(['authors', 'books']));
	expect(body.tables.books).toContain('id');
	expect((await page.request.get('/api/sql/schema?db=tmp_t5b_nope')).status()).toBe(404);
	expect((await page.request.get('/api/sql/schema')).status()).toBe(400);
});
