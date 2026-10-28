import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Cell } from './format.ts';
import ResultGrid from './result-grid.svelte';
import type { GridColumn } from './types.ts';

const columns: GridColumn[] = [
	{ name: 'id', kind: 'integer', key: 'PRI', type: 'int' },
	{ name: 'title', kind: 'text', type: 'varchar(255)', editable: true },
	{ name: 'cover', kind: 'binary', type: 'blob' },
	{ name: 'meta', kind: 'json', type: 'json' }
];
const long = 'x'.repeat(80);
const rows: Cell[][] = [
	['1', 'Solaris', { bytes: 12, preview: '00ff' }, '{"a":[1,2]}'],
	['2', null, null, null],
	['3', long, { bytes: 2048, preview: '' }, null]
];

describe('result-grid.svelte', () => {
	it('renders headers, values and NULL as muted italic text', async () => {
		const screen = await render(ResultGrid, { columns, rows });
		await expect.element(screen.getByRole('columnheader', { name: 'title' })).toBeVisible();
		await expect.element(screen.getByText('Solaris')).toBeVisible();
		const nulls = screen.getByText('NULL', { exact: true }).elements();
		expect(nulls.length).toBe(4);
		expect(nulls[0].className).toContain('italic');
		expect(nulls[0].className).toContain('text-muted-foreground');
	});

	it('aligns numbers to the end and shows binary as [BLOB - n B] with a download link', async () => {
		const screen = await render(ResultGrid, {
			columns,
			rows,
			downloadHref: (row: number, column: GridColumn) => `/dl/${row}/${column.name}`
		});
		const idCell = screen.getByRole('cell', { name: '1', exact: true }).element();
		expect(idCell.className).toContain('text-end');
		expect(idCell.className).toContain('tabular-nums');
		await expect.element(screen.getByText('[BLOB - 12 B]')).toBeVisible();
		await expect.element(screen.getByText('[BLOB - 2.0 KiB]')).toBeVisible();
		await expect
			.element(screen.getByRole('link', { name: 'Download' }).first())
			.toHaveAttribute('href', '/dl/0/cover');
	});

	it('truncates long text to limitChars and toggles the full text', async () => {
		const screen = await render(ResultGrid, { columns, rows, limitChars: 20 });
		await expect.element(screen.getByText('x'.repeat(20) + '…')).toBeVisible();
		expect(screen.getByText(long).elements()).toHaveLength(0);
		await screen.getByRole('button', { name: 'more' }).click();
		await expect.element(screen.getByText(long)).toBeVisible();
		await screen.getByRole('button', { name: 'less' }).click();
		await expect.element(screen.getByText('x'.repeat(20) + '…')).toBeVisible();
	});

	it('cycles the sort on header clicks and reports it', async () => {
		const onsort = vi.fn();
		const screen = await render(ResultGrid, { columns, rows, onsort, order: 'ASC' });
		await screen.getByRole('button', { name: 'title' }).click();
		expect(onsort).toHaveBeenLastCalledWith({ column: 'title', dir: 'asc' });
	});

	it('shows the sort state and continues asc, desc, none', async () => {
		const onsort = vi.fn();
		const screen = await render(ResultGrid, {
			columns,
			rows,
			onsort,
			order: 'ASC',
			sort: { column: 'title', dir: 'asc' }
		});
		await expect
			.element(screen.getByRole('columnheader', { name: 'title' }))
			.toHaveAttribute('aria-sort', 'ascending');
		await screen.getByRole('button', { name: 'title' }).click();
		expect(onsort).toHaveBeenLastCalledWith({ column: 'title', dir: 'desc' });
	});

	it('clears the sort on the third click', async () => {
		const onsort = vi.fn();
		const screen = await render(ResultGrid, {
			columns,
			rows,
			onsort,
			order: 'ASC',
			sort: { column: 'title', dir: 'desc' }
		});
		await screen.getByRole('button', { name: 'title' }).click();
		expect(onsort).toHaveBeenLastCalledWith(null);
	});

	it('hides columns from the column menu', async () => {
		const onhiddenchange = vi.fn();
		const screen = await render(ResultGrid, { columns, rows, onhiddenchange });
		await screen.getByRole('button', { name: /Columns/ }).click();
		await screen.getByRole('menuitemcheckbox', { name: 'title' }).click();
		expect(onhiddenchange).toHaveBeenLastCalledWith(['title']);
		expect(screen.getByRole('columnheader', { name: 'title' }).elements()).toHaveLength(0);
	});

	it('edits a cell on double click and shows the stored value', async () => {
		const onedit = vi.fn(async (_r: number, _c: GridColumn, value: string | null) => ({
			ok: true as const,
			cell: value === null ? null : value.toUpperCase()
		}));
		const screen = await render(ResultGrid, { columns, rows, onedit });
		await screen.getByText('Solaris').dblClick();
		const input = screen.getByRole('textbox', { name: 'title value' });
		await input.fill('hello');
		await screen.getByRole('button', { name: 'Save' }).click();
		expect(onedit).toHaveBeenCalledWith(0, columns[1], 'hello');
		await expect.element(screen.getByText('HELLO')).toBeVisible();
	});

	it('keeps the editor open and shows the error when saving fails', async () => {
		const onedit = vi.fn(async () => ({ ok: false as const, error: 'Data too long' }));
		const screen = await render(ResultGrid, { columns, rows, onedit });
		await screen.getByText('Solaris').dblClick();
		await screen.getByRole('button', { name: 'Save' }).click();
		await expect.element(screen.getByRole('alert')).toHaveTextContent('Data too long');
		await expect.element(screen.getByRole('textbox', { name: 'title value' })).toBeVisible();
	});

	it('does not edit without onedit', async () => {
		const screen = await render(ResultGrid, { columns, rows });
		await screen.getByText('Solaris').dblClick();
		expect(screen.getByRole('textbox').elements()).toHaveLength(0);
	});

	it('selects rows with checkboxes', async () => {
		const screen = await render(ResultGrid, { columns, rows, selectable: true });
		await screen.getByRole('checkbox', { name: 'Select all rows' }).click();
		await expect.element(screen.getByRole('checkbox', { name: 'Select row 2' })).toBeChecked();
	});

	it('opens formatted JSON in a popover', async () => {
		const screen = await render(ResultGrid, { columns, rows });
		await screen.getByRole('button', { name: '{"a":[1,2]}' }).click();
		await expect.element(screen.getByTestId('json-popover')).toHaveTextContent('{ "a": [ 1, 2 ] }');
	});
});
