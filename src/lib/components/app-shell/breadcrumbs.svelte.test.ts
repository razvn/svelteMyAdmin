import '../../../app.css';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
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

	it('keeps the database and table crumbs visible on a narrow bar, ellipsizing the server', async () => {
		await page.viewport(800, 600);
		const screen = await render(Breadcrumbs, {
			nav,
			serverLabel: 'Local MySQL 8.4 with a very long verbose server name',
			db: 'sma_test',
			table: 'books'
		});
		const wrap = document.createElement('div');
		const host = screen.container.firstElementChild!;
		wrap.style.width = '420px';
		host.parentElement!.insertBefore(wrap, host);
		wrap.appendChild(host);
		const server = screen.getByRole('link', { name: /Local MySQL/ }).element();
		const db = screen.getByRole('link', { name: /sma_test/ }).element();
		const table = screen.getByRole('link', { name: /books/ }).element();
		for (const el of [server, db, table]) {
			expect(el.getBoundingClientRect().height).toBeLessThan(30); // never wraps
		}
		expect(db.getBoundingClientRect().width).toBeGreaterThan(30);
		expect(table.getBoundingClientRect().width).toBeGreaterThan(30);
		expect(server.scrollWidth).toBeGreaterThan(server.clientWidth); // ellipsized first
	});
});
