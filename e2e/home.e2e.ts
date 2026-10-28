import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login, submitLogin } from './helpers.ts';

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
test.beforeEach(() => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
});

test('health endpoint is public', async ({ request }) => {
	const res = await request.get('/api/health');
	expect(await res.json()).toEqual({ ok: true });
});

test('unauthenticated / goes to the login page', async ({ page }) => {
	await gotoReady(page, '/');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});

test('wrong password shows an error', async ({ page }) => {
	await gotoReady(page, '/login');
	await submitLogin(page, 'definitely-wrong');
	await expect(page.getByTestId('login-error')).toContainText('Cannot log in to the MySQL server');
	await expect(page).toHaveURL(/\/login/);
});

test('login, home, logout', async ({ page }) => {
	await login(page);
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('heading', { level: 1, name: 'svelteMyAdmin' })).toBeVisible();
	await expect(page.getByTestId('connection-info')).toContainText('root@127.0.0.1:33306');
	// logged in users skip the login page
	await gotoReady(page, '/login');
	await expect(page).toHaveURL(/\/$/);

	await page.getByRole('button', { name: 'User menu' }).click();
	await page.getByRole('menuitem', { name: 'Log out' }).click();
	await expect(page).toHaveURL(/\/login$/);
	await gotoReady(page, '/');
	await expect(page).toHaveURL(/\/login$/);
});

test('unauthenticated protected page redirects with ?redirect and returns after login', async ({
	page
}) => {
	await gotoReady(page, '/server/databases');
	await expect(page).toHaveURL(/\/login\?redirect=%2Fserver%2Fdatabases$/);
	await submitLogin(page);
	await expect(page).toHaveURL(/\/server\/databases$/);
});

test('open redirects are ignored', async ({ page }) => {
	await gotoReady(page, '/login?redirect=//evil.example/x');
	await submitLogin(page);
	await expect(page).toHaveURL(/localhost:\d+\/$/);
});

test('legacy index.php URL redirects after login', async ({ page }) => {
	await gotoReady(page, '/index.php?route=/database/structure&db=sma_test');
	await expect(page).toHaveURL(/\/login\?redirect=%2Fdb%2Fsma_test%2Fstructure$/);
	await submitLogin(page);
	await expect(page).toHaveURL(/\/db\/sma_test\/structure$/);
});
