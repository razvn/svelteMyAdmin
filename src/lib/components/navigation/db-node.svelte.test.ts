import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { DEFAULT_NAV_CONFIG } from '#lib/nav/config.ts';
import type { DbChildren } from '#lib/nav/types.ts';
import { NavState } from './nav-state.svelte.ts';
import DbNodeHost from './testing/db-node-host.svelte';

const children: DbChildren = {
	db: 'sma_test',
	tables: ['authors', 'books'],
	views: ['v_book_authors'],
	procedures: ['sp_books_by_author'],
	functions: ['fn_book_count'],
	events: []
};

function setup(props: Partial<{ currentDb: string; currentTable: string }> = {}, fetcher?: never) {
	const fetchChildren = vi.fn(async () => children);
	const navState = new NavState(fetcher ?? fetchChildren);
	return {
		fetchChildren,
		navState,
		render: () =>
			render(DbNodeHost, { name: 'sma_test', nav: DEFAULT_NAV_CONFIG, navState, ...props })
	};
}

describe('db-node.svelte', () => {
	it('is collapsed at first and does not fetch', async () => {
		const t = setup();
		const screen = await t.render();
		await expect.element(screen.getByRole('link', { name: 'sma_test' })).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Expand sma_test' }))
			.toHaveAttribute('aria-expanded', 'false');
		expect(t.fetchChildren).not.toHaveBeenCalled();
		expect(screen.getByText('books').elements()).toHaveLength(0);
	});

	it('lazy-loads its children on expand and groups them with counts', async () => {
		const t = setup();
		const screen = await t.render();
		await screen.getByRole('button', { name: 'Expand sma_test' }).click();

		expect(t.fetchChildren).toHaveBeenCalledExactlyOnceWith('sma_test');
		await expect.element(screen.getByRole('link', { name: 'books', exact: true })).toBeVisible();
		await expect.element(screen.getByRole('link', { name: 'v_book_authors' })).toBeVisible();
		await expect.element(screen.getByRole('link', { name: 'sp_books_by_author' })).toBeVisible();
		await expect.element(screen.getByRole('link', { name: 'fn_book_count' })).toBeVisible();
		await expect
			.element(screen.getByTestId('nav-group-tables').getByTestId('count').first())
			.toHaveTextContent('2');
		// tables link to the DefaultTabTable (browse), routines to the routines tab with a query
		await expect
			.element(screen.getByRole('link', { name: 'books', exact: true }))
			.toHaveAttribute('href', '/db/sma_test/table/books/browse');
		await expect
			.element(screen.getByRole('link', { name: 'sp_books_by_author' }))
			.toHaveAttribute('href', '/db/sma_test/routines?type=PROCEDURE&item=sp_books_by_author');
		await expect
			.element(screen.getByRole('link', { name: 'New table' }))
			.toHaveAttribute('href', '/db/sma_test/structure');
	});

	it('collapses again and keeps the loaded data (no second fetch)', async () => {
		const t = setup();
		const screen = await t.render();
		await screen.getByRole('button', { name: 'Expand sma_test' }).click();
		await expect.element(screen.getByRole('link', { name: 'books', exact: true })).toBeVisible();

		await screen.getByRole('button', { name: 'Collapse sma_test' }).click();
		expect(screen.getByText('books').elements()).toHaveLength(0);
		await screen.getByRole('button', { name: 'Expand sma_test' }).click();
		await expect.element(screen.getByRole('link', { name: 'books', exact: true })).toBeVisible();
		expect(t.fetchChildren).toHaveBeenCalledTimes(1);
	});

	it('expands automatically when it is the current database and highlights the table', async () => {
		const t = setup({ currentDb: 'sma_test', currentTable: 'books' });
		const screen = await t.render();
		await expect.element(screen.getByRole('link', { name: 'books', exact: true })).toBeVisible();
		await expect
			.element(screen.getByRole('link', { name: 'books', exact: true }))
			.toHaveAttribute('aria-current', 'page');
		await expect
			.element(screen.getByRole('link', { name: 'authors', exact: true }))
			.not.toHaveAttribute('aria-current');
	});

	it('shows an error with a retry when loading fails', async () => {
		let fail = true;
		const fetcher = vi.fn(async () => {
			if (fail) throw new Error('boom');
			return children;
		});
		const t = setup({}, fetcher as never);
		const screen = await t.render();
		await screen.getByRole('button', { name: 'Expand sma_test' }).click();
		await expect.element(screen.getByRole('button', { name: /Could not load/ })).toBeVisible();
		fail = false;
		await screen.getByRole('button', { name: /Could not load/ }).click();
		await expect.element(screen.getByRole('link', { name: 'books', exact: true })).toBeVisible();
	});

	it('is keyboard accessible', async () => {
		const t = setup();
		const screen = await t.render();
		const toggle = screen.getByRole('button', { name: 'Expand sma_test' });
		(toggle.element() as HTMLElement).focus();
		const { userEvent } = await import('vitest/browser');
		await userEvent.keyboard('{Enter}');
		await expect.element(screen.getByRole('link', { name: 'books', exact: true })).toBeVisible();
	});
});
