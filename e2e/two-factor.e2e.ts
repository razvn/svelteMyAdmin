import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { totp } from '../src/lib/server/two-factor/totp.ts';
import { gotoReady } from './helpers.ts';

// Dedicated MySQL users (never root: other specs log in as root and must not meet a 2FA prompt).
const PASSWORD = 'T9d-Pass-1!';
const USERS = { totp: 'tmp_t9d_totp', rate: 'tmp_t9d_rate', key: 'tmp_t9d_key' };
// the secret of the pre-configured rate-limit user (written the way phpMyAdmin stores it)
const RATE_SECRET = 'JBSWY3DPEHPK3PXP';

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
const cleanup = () =>
	withRoot(async (c) => {
		for (const u of Object.values(USERS)) {
			await c.query(`DROP USER IF EXISTS '${u}'@'%'`);
			await c.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [u]);
		}
	});

let dbUp = false;
test.beforeAll(async () => {
	try {
		await cleanup();
		await withRoot(async (c) => {
			for (const u of Object.values(USERS)) {
				await c.query(`CREATE USER '${u}'@'%' IDENTIFIED BY '${PASSWORD}'`);
				await c.query(`GRANT SELECT ON sma_test.* TO '${u}'@'%'`);
			}
			await c.query(
				'INSERT INTO phpmyadmin.pma__userconfig (username, timevalue, config_data) VALUES (?, NOW(), ?)',
				[
					USERS.rate,
					JSON.stringify({ '2fa': { backend: 'application', settings: { secret: RATE_SECRET } } })
				]
			);
		});
		dbUp = true;
	} catch {
		dbUp = false;
	}
});
test.afterAll(async () => {
	if (dbUp) await cleanup();
});
test.beforeEach(() => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
});

const main = (page: Page) => page.getByRole('main');

async function submitCredentials(page: Page, user: string) {
	await gotoReady(page, '/login');
	await page.getByLabel('Username').fill(user);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Log in' }).click();
}

async function loginPlain(page: Page, user: string) {
	await submitCredentials(page, user);
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

test('authenticator app: enable, prompted at login, wrong code rejected, disable', async ({
	page,
	context
}) => {
	const user = USERS.totp;
	await loginPlain(page, user);

	// Enable
	await gotoReady(page, '/server/settings/two-factor');
	await expect(main(page).getByTestId('2fa-status')).toContainText('not configured');
	await main(page)
		.getByRole('radio', { name: /Authentication Application/ })
		.click();
	await main(page).getByRole('button', { name: 'Configure two-factor authentication' }).click();
	await expect(main(page).getByTestId('2fa-qr').locator('svg')).toBeVisible();
	const secret = (await main(page).getByTestId('2fa-secret').textContent())!.trim();
	expect(secret).toMatch(/^[A-Z2-7]{32}$/);

	// a wrong code does not enable it, and the secret stays the same
	await main(page).getByLabel('Authentication code:').fill('000000');
	await main(page).getByRole('button', { name: 'Enable two-factor authentication' }).click();
	await expect(main(page).getByTestId('2fa-error')).toContainText(
		'Two-factor authentication failed'
	);
	await expect(main(page).getByTestId('2fa-secret')).toHaveText(secret);

	await main(page).getByLabel('Authentication code:').fill(totp(secret));
	await main(page).getByRole('button', { name: 'Enable two-factor authentication' }).click();
	await expect(main(page).getByTestId('2fa-saved')).toContainText('has been configured');
	await expect(main(page).getByTestId('2fa-backend-name')).toHaveText(
		'Authentication Application (2FA)'
	);

	// stored like phpMyAdmin does
	const stored = await withRoot(async (c) => {
		const [rows] = await c.query(
			'SELECT config_data FROM phpmyadmin.pma__userconfig WHERE username = ?',
			[user]
		);
		return JSON.parse((rows as { config_data: string }[])[0].config_data);
	});
	expect(stored['2fa']).toEqual({ backend: 'application', settings: { secret } });

	// Log out (drop the session cookies) and log in again
	await context.clearCookies();
	await submitCredentials(page, user);
	await expect(page).toHaveURL(/\/login\/2fa/);
	await expect(page.getByTestId('login-error')).toHaveCount(0);

	// every other page returns to the prompt until the code was given
	await gotoReady(page, '/server/settings');
	await expect(page).toHaveURL(/\/login\/2fa/);
	await gotoReady(page, '/');
	await expect(page).toHaveURL(/\/login\/2fa/);

	await page.getByLabel('Authentication code:').fill('123456');
	await page.getByRole('button', { name: 'Verify' }).click();
	await expect(page.getByTestId('2fa-error')).toContainText('Two-factor authentication failed');
	await expect(page).toHaveURL(/\/login\/2fa/);

	await page.getByLabel('Authentication code:').fill(totp(secret));
	await page.getByRole('button', { name: 'Verify' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');

	// the prompt is gone for the verified session
	await gotoReady(page, '/server/settings');
	await expect(page).toHaveURL(/\/server\/settings$/);

	// Disable needs the current second factor
	await gotoReady(page, '/server/settings/two-factor');
	await main(page).getByRole('button', { name: 'Disable two-factor authentication' }).click();
	await expect(main(page).getByText('Confirm disabling two-factor authentication')).toBeVisible();
	await main(page).getByLabel('Authentication code:').fill('000000');
	await main(page).getByRole('button', { name: 'Disable two-factor authentication' }).click();
	await expect(main(page).getByTestId('2fa-error')).toContainText(
		'Two-factor authentication failed'
	);
	await main(page).getByLabel('Authentication code:').fill(totp(secret));
	await main(page).getByRole('button', { name: 'Disable two-factor authentication' }).click();
	await expect(main(page).getByTestId('2fa-saved')).toContainText('has been removed');
	await expect(main(page).getByTestId('2fa-status')).toContainText('not configured');

	// password-only login again
	await context.clearCookies();
	await loginPlain(page, user);
});

test('wrong codes are rate limited per user, even across new logins', async ({ page, context }) => {
	const user = USERS.rate;
	await submitCredentials(page, user);
	await expect(page).toHaveURL(/\/login\/2fa/);
	for (let i = 0; i < 5; i++) {
		await page.getByLabel('Authentication code:').fill('000000');
		await page.getByRole('button', { name: 'Verify' }).click();
		await expect(page.getByTestId('2fa-error')).toContainText('Two-factor authentication failed');
	}
	// now even the right code is refused
	await page.getByLabel('Authentication code:').fill(totp(RATE_SECRET));
	await page.getByRole('button', { name: 'Verify' }).click();
	await expect(page.getByTestId('2fa-error')).toContainText('Too many failed attempts');
	await expect(page).toHaveURL(/\/login\/2fa/);

	// a fresh login does not reset the counter
	await context.clearCookies();
	await submitCredentials(page, user);
	await expect(page).toHaveURL(/\/login\/2fa/);
	await page.getByLabel('Authentication code:').fill(totp(RATE_SECRET));
	await page.getByRole('button', { name: 'Verify' }).click();
	await expect(page.getByTestId('2fa-error')).toContainText('Too many failed attempts');
});

test('security key (WebAuthn, virtual authenticator): register, log in, disable', async ({
	page,
	context
}) => {
	const user = USERS.key;
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'usb',
			hasResidentKey: false,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	await loginPlain(page, user);

	await gotoReady(page, '/server/settings/two-factor');
	await main(page)
		.getByRole('radio', { name: /Hardware Security Key/ })
		.click();
	await main(page).getByRole('button', { name: 'Configure two-factor authentication' }).click();
	await main(page).getByRole('button', { name: 'Register security key' }).click();
	await expect(main(page).getByTestId('2fa-saved')).toContainText('has been configured');
	await expect(main(page).getByTestId('2fa-backend-name')).toContainText('Hardware Security Key');

	const stored = await withRoot(async (c) => {
		const [rows] = await c.query(
			'SELECT config_data FROM phpmyadmin.pma__userconfig WHERE username = ?',
			[user]
		);
		return JSON.parse((rows as { config_data: string }[])[0].config_data);
	});
	expect(stored['2fa'].backend).toBe('WebAuthn');
	const creds = Object.values(stored['2fa'].settings.credentials) as Record<string, unknown>[];
	expect(creds).toHaveLength(1);
	expect(creds[0]).toMatchObject({
		type: 'public-key',
		userHandle: stored['2fa'].settings.userHandle
	});
	expect(typeof creds[0].credentialPublicKey).toBe('string');

	await context.clearCookies();
	await submitCredentials(page, user);
	await expect(page).toHaveURL(/\/login\/2fa/);
	await page.getByRole('button', { name: 'Use security key' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');

	// disabling asks for the key again
	await gotoReady(page, '/server/settings/two-factor');
	await main(page).getByRole('button', { name: 'Disable two-factor authentication' }).click();
	await main(page).getByRole('button', { name: 'Use security key' }).click();
	await expect(main(page).getByTestId('2fa-saved')).toContainText('has been removed');
});
