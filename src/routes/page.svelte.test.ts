import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('+page.svelte', () => {
	it('renders the app name, connection info and logout button', async () => {
		const screen = await render(Page, {
			data: { user: 'root', host: '127.0.0.1:33306', serverLabel: 'Local MySQL', canLogout: true }
		} as never);
		await expect
			.element(screen.getByRole('heading', { level: 1 }))
			.toHaveTextContent('svelteMyAdmin');
		await expect
			.element(screen.getByTestId('connection-info'))
			.toHaveTextContent('Connected as root@127.0.0.1:33306');
		await expect.element(screen.getByRole('button', { name: 'Log out' })).toBeVisible();
	});
});
