import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { serverTabs, tabHref } from '#lib/nav/tabs.ts';
import TabBar from './tab-bar.svelte';

const tabs = serverTabs();
const props = {
	label: 'Server',
	tabs,
	current: 'status/processes',
	hrefFor: (tab: { path: string }) => tabHref('server', {}, tab.path)
};

describe('tab-bar.svelte', () => {
	afterEach(async () => {
		await page.viewport(414, 896);
	});

	it('renders every tab as a link and marks the active one', async () => {
		await page.viewport(1800, 800);
		const screen = await render(TabBar, props);
		const nav = screen.getByRole('navigation', { name: 'Server' });
		for (const tab of tabs) {
			await expect.element(nav.getByRole('link', { name: tab.label, exact: true })).toBeVisible();
		}
		await expect
			.element(nav.getByRole('link', { name: 'Status' }))
			.toHaveAttribute('aria-current', 'page');
		await expect
			.element(nav.getByRole('link', { name: 'Databases' }))
			.toHaveAttribute('href', '/server/databases');
		expect(screen.getByRole('button', { name: 'More' }).elements()).toHaveLength(0);
	});

	it('moves tabs that do not fit into a More menu', async () => {
		await page.viewport(360, 800);
		const screen = await render(TabBar, props);
		await expect.element(screen.getByRole('button', { name: 'More' })).toBeVisible();
		await screen.getByRole('button', { name: 'More' }).click();
		await expect.element(screen.getByRole('menuitem', { name: 'Plugins' })).toBeVisible();
	});
});
