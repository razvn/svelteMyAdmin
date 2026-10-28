import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { CONSOLE_KEY, type ConsoleState } from './console-state.svelte.ts';
import Harness from './testing/console-harness.svelte';

const result = {
	statements: [
		{
			ok: true,
			index: 0,
			sql: 'SELECT 1',
			executedSql: 'SELECT 1',
			kind: 'select',
			resultSets: [
				{
					fields: [{ name: '1', kind: 'integer', type: 'int' }],
					rows: [['1']],
					truncated: false,
					keys: null,
					source: null
				}
			],
			affectedRows: 0,
			insertId: null,
			info: '',
			warnings: [],
			durationMs: 1,
			pagination: { pos: 0, size: 25, total: 1, hasMore: false },
			profile: null
		}
	],
	stopped: false,
	rolledBack: false,
	totalMs: 1
};

describe('console drawer', () => {
	beforeEach(() => localStorage.removeItem(CONSOLE_KEY));
	afterEach(() => {
		vi.restoreAllMocks();
		localStorage.removeItem(CONSOLE_KEY);
	});

	it('toggles with the button and remembers the state', async () => {
		const screen = await render(Harness, { db: 'shop' });
		expect(screen.container.querySelector('[data-testid="console"]')).toBeNull();

		await page.getByRole('button', { name: 'Toggle SQL console' }).click();
		await expect.element(page.getByTestId('console')).toBeVisible();
		await expect
			.poll(() => page.getByTestId('console-context').element().textContent)
			.toContain('shop');
		expect(JSON.parse(localStorage.getItem(CONSOLE_KEY)!).open).toBe(true);

		await page.getByRole('button', { name: 'Close console' }).click();
		expect(screen.container.querySelector('[data-testid="console"]')).toBeNull();
		expect(JSON.parse(localStorage.getItem(CONSOLE_KEY)!).open).toBe(false);
	});

	it('toggles with Ctrl+Alt+C', async () => {
		const screen = await render(Harness);
		window.dispatchEvent(
			new KeyboardEvent('keydown', { code: 'KeyC', ctrlKey: true, altKey: true, cancelable: true })
		);
		await expect.element(page.getByTestId('console')).toBeVisible();
		window.dispatchEvent(
			new KeyboardEvent('keydown', { code: 'KeyC', metaKey: true, altKey: true, cancelable: true })
		);
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="console"]')).toBeNull()
		);
	});

	it('restores a stored open state and height', async () => {
		localStorage.setItem(CONSOLE_KEY, JSON.stringify({ open: true, height: 420, tab: 'console' }));
		await render(Harness);
		const el = page.getByTestId('console').element() as HTMLElement;
		expect(el.style.height).toBe('420px');
	});

	it('resizes with the keyboard', async () => {
		let st: ConsoleState | undefined;
		await render(Harness, { onstate: (s: ConsoleState) => (st = s) });
		st!.setOpen(true);
		const handle = page.getByTestId('console-resize');
		await expect.poll(() => handle.element()).toBeTruthy();
		const before = st!.height;
		(handle.element() as HTMLElement).dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
		);
		await vi.waitFor(() => expect(st!.height).toBe(before + 24));
	});

	it('runs a query in the route context and shows a compact result', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = String(input);
			if (url.startsWith('/api/sql/run')) return Response.json(result);
			return Response.json({});
		});
		let st: ConsoleState | undefined;
		await render(Harness, { db: 'shop', table: 'books', onstate: (s: ConsoleState) => (st = s) });
		st!.setOpen(true);
		st!.input = 'SELECT 1';
		await page.getByRole('button', { name: 'Run', exact: true }).click();
		await expect.element(page.getByTestId('console-table')).toBeVisible();
		await expect
			.poll(() => page.getByTestId('console-status').element().textContent)
			.toContain('1 row');
		const call = fetchSpy.mock.calls.find((c) => String(c[0]).startsWith('/api/sql/run'))!;
		expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
			sql: 'SELECT 1',
			db: 'shop',
			table: 'books'
		});
		await expect
			.element(page.getByRole('link', { name: 'Open in SQL page' }))
			.toHaveAttribute('href', '/db/shop/table/books/sql?sql_query=SELECT%201');
	});
});
