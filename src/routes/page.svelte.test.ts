import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('+page.svelte', () => {
	it('renders the app name', async () => {
		const screen = await render(Page);
		await expect
			.element(screen.getByRole('heading', { level: 1 }))
			.toHaveTextContent('svelteMyAdmin');
	});
});
