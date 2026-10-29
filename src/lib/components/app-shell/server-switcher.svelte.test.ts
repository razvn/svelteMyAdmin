import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerSwitcher from './server-switcher.svelte';

function makeServers(count: number) {
	return Array.from({ length: count }, (_, i) => {
		const n = i + 1;
		const pad = String(n).padStart(2, '0');
		return {
			index: n,
			label: `staging-${pad}`,
			host: `db${pad}.staging.test`,
			port: 3300 + n,
			auth: 'cookie'
		};
	});
}

const menuLabels = () =>
	Array.from(document.querySelectorAll('[role="menuitemradio"]')).map((el) =>
		el.textContent?.trim()
	);

describe('server-switcher.svelte', () => {
	it('shows no search box for five servers or fewer', async () => {
		const screen = await render(ServerSwitcher, { servers: makeServers(5), current: 1 });
		await screen.getByRole('button', { name: 'Switch server' }).click();
		await expect.element(screen.getByRole('menuitemradio', { name: 'staging-01' })).toBeVisible();
		expect(document.querySelector('input[type="search"]')).toBeNull();
	});

	it('shows a search box for more than five servers and focuses it on open', async () => {
		const screen = await render(ServerSwitcher, { servers: makeServers(6), current: 1 });
		await screen.getByRole('button', { name: 'Switch server' }).click();
		await expect.element(screen.getByPlaceholder('Filter servers…')).toBeVisible();
		await expect
			.poll(() => (document.activeElement as HTMLElement | null)?.getAttribute('placeholder'))
			.toBe('Filter servers…');
	});

	it('filters the menu by label, host and port, case-insensitively', async () => {
		const screen = await render(ServerSwitcher, { servers: makeServers(12), current: 1 });
		await screen.getByRole('button', { name: 'Switch server' }).click();
		const input = screen.getByPlaceholder('Filter servers…');

		await input.fill('STAGING-10');
		await expect.poll(menuLabels).toEqual(['staging-10']);

		await input.fill('db11.staging');
		await expect.poll(menuLabels).toEqual(['staging-11']);

		await input.fill('3312');
		await expect.poll(menuLabels).toEqual(['staging-12']);
	});

	it('shows a hint when nothing matches', async () => {
		const screen = await render(ServerSwitcher, { servers: makeServers(6), current: 1 });
		await screen.getByRole('button', { name: 'Switch server' }).click();
		await screen.getByPlaceholder('Filter servers…').fill('nope');
		await expect.element(screen.getByRole('status')).toHaveTextContent('No server matches');
		await expect.poll(menuLabels).toEqual([]);
	});

	it('keeps typed characters in the search box instead of menu typeahead', async () => {
		const screen = await render(ServerSwitcher, { servers: makeServers(6), current: 1 });
		await screen.getByRole('button', { name: 'Switch server' }).click();
		await userEvent.keyboard('db03');
		await expect.element(screen.getByPlaceholder('Filter servers…')).toHaveValue('db03');
	});
});
