import { expect, type Page, type Response } from '@playwright/test';

/**
 * Navigate and wait until Svelte has hydrated (the root layout sets `html[data-hydrated="true"]`).
 * Always use this instead of `page.goto`: SSR HTML is visible before hydration, and interactions
 * (bits-ui selects/dialogs, bound inputs, client-built form payloads) made before it are lost.
 */
export async function gotoReady(
	page: Page,
	url: string,
	options?: Parameters<Page['goto']>[1]
): Promise<Response | null> {
	const response = await page.goto(url, options);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	return response;
}

/** Wait for hydration after an action that triggered a full document load (e.g. `page.reload()`). */
export async function reloadReady(page: Page): Promise<void> {
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

/** Fill and submit the login form that is already on screen. */
export async function submitLogin(page: Page, password = 'root') {
	await page.getByLabel('Username').fill('root');
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Log in' }).click();
}

/** Open the login page, log in, and resolve once the home page has loaded and hydrated. */
export async function login(page: Page, password = 'root') {
	await gotoReady(page, '/login');
	await submitLogin(page, password);
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}
