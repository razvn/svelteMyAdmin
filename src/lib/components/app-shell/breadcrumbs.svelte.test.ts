import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { DEFAULT_NAV_CONFIG } from '#lib/nav/config.ts';
import Breadcrumbs from './breadcrumbs.svelte';

const nav = DEFAULT_NAV_CONFIG;

describe('breadcrumbs.svelte', () => {
	it('shows only the server at the root', async () => {
		const screen = await render(Breadcrumbs, { nav, serverLabel: 'Local MySQL' });
		await expect
			.element(screen.getByRole('link', { name: /Local MySQL/ }))
			.toHaveAttribute('href', '/');
		await expect
			.element(screen.getByRole('link', { name: /Local MySQL/ }))
			.toHaveAttribute('aria-current', 'page');
		expect(screen.getByText('Database:').elements()).toHaveLength(0);
	});

	it('links every level to its default tab', async () => {
		const screen = await render(Breadcrumbs, {
			nav: { ...nav, defaultTabServer: 'databases' },
			serverLabel: '127.0.0.1:33306',
			db: 'sma_test',
			table: 'books'
		});
		await expect
			.element(screen.getByRole('link', { name: /127\.0\.0\.1:33306/ }))
			.toHaveAttribute('href', '/server/databases');
		await expect
			.element(screen.getByRole('link', { name: /sma_test/ }))
			.toHaveAttribute('href', '/db/sma_test/structure');
		const table = screen.getByRole('link', { name: /books/ });
		await expect.element(table).toHaveAttribute('href', '/db/sma_test/table/books/browse');
		await expect.element(table).toHaveAttribute('aria-current', 'page');
		expect(table.element().textContent).toContain('Table:');
	});

	it('labels views and encodes names', async () => {
		const screen = await render(Breadcrumbs, {
			nav,
			serverLabel: 'x',
			db: 'my db',
			table: 'v/1',
			tableType: 'view'
		});
		const view = screen.getByRole('link', { name: /v\/1/ });
		expect(view.element().textContent).toContain('View:');
		await expect.element(view).toHaveAttribute('href', '/db/my%20db/table/v%2F1/browse');
	});
});
