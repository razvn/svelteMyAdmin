import { expect, test } from '@playwright/test';

test('home page shows svelteMyAdmin', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'svelteMyAdmin' })).toBeVisible();
});
