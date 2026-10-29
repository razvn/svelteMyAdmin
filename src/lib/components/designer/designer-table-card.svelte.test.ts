import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { DesignerTable } from '#lib/designer/types.ts';
import DesignerTableCard from './designer-table-card.svelte';

const col = (name: string, extra: object = {}) => ({
	name,
	type: 'int',
	nullable: false,
	default: null,
	primary: false,
	unique: false,
	indexed: false,
	foreign: false,
	...extra
});
const books: DesignerTable = {
	name: 'books',
	engine: 'InnoDB',
	displayField: '',
	columns: [
		col('id', { primary: true }),
		col('author_id', { foreign: true }),
		col('isbn', { unique: true }),
		col('title', { type: 'varchar(200)' })
	]
};

describe('designer-table-card.svelte', () => {
	it('renders the columns with their types and key icons', async () => {
		const screen = await render(DesignerTableCard, { table: books, x: 10, y: 20, width: 200 });
		await expect.element(screen.getByText('books', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('varchar(200)')).toBeVisible();
		await expect.element(screen.getByLabelText('Primary key')).toBeInTheDocument();
		await expect.element(screen.getByLabelText('Foreign key')).toBeInTheDocument();
		await expect.element(screen.getByLabelText('Unique key')).toBeInTheDocument();
	});

	it('lists only keys in the keys-only view', async () => {
		const keys = await render(DesignerTableCard, {
			table: books,
			x: 0,
			y: 0,
			width: 200,
			keysOnly: true
		});
		expect(keys.getByText('title').elements()).toHaveLength(0);
		await expect.element(keys.getByText('author_id')).toBeVisible();
	});

	it('lists no column when collapsed', async () => {
		const small = await render(DesignerTableCard, {
			table: books,
			x: 0,
			y: 0,
			width: 200,
			collapsed: true
		});
		expect(small.getByText('author_id').elements()).toHaveLength(0);
	});

	it('reports the new position while the header is dragged', async () => {
		const onmove = vi.fn();
		const onmoveend = vi.fn();
		const screen = await render(DesignerTableCard, {
			table: books,
			x: 100,
			y: 100,
			width: 200,
			scale: 2,
			onmove,
			onmoveend
		});
		const header = screen.getByTestId('designer-header-books').element() as HTMLElement;
		const fire = (type: string, x: number, y: number) =>
			header.dispatchEvent(
				new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true })
			);
		header.setPointerCapture = () => {};
		fire('pointerdown', 50, 50);
		fire('pointermove', 90, 70);
		fire('pointerup', 90, 70);
		// deltas are divided by the zoom (2)
		expect(onmove).toHaveBeenLastCalledWith(120, 110);
		expect(onmoveend).toHaveBeenCalledTimes(1);
	});
});
