import { describe, expect, it } from 'vitest';
import { userPrefersMode } from 'mode-watcher';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ThemeToggle from './theme-toggle.svelte';

describe('theme-toggle.svelte', () => {
	it('offers light, dark and system and stores the choice', async () => {
		const screen = await render(ThemeToggle);
		await screen.getByRole('button', { name: 'Toggle theme' }).click();
		await expect.element(screen.getByRole('menuitemradio', { name: 'Light' })).toBeVisible();
		await expect.element(screen.getByRole('menuitemradio', { name: 'System' })).toBeVisible();
		await screen.getByRole('menuitemradio', { name: 'Dark' }).click();
		await expect.poll(() => userPrefersMode.current).toBe('dark');
		await userEvent.keyboard('{Escape}');
		await screen.getByRole('button', { name: 'Toggle theme' }).click();
		await screen.getByRole('menuitemradio', { name: 'Light' }).click();
		await expect.poll(() => userPrefersMode.current).toBe('light');
	});
});
