import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import {
	toColumnMeta,
	type FormCell,
	type FormColumn,
	type InputSettings
} from '#lib/sql/insert-edit.ts';
import InsertValueInput from './insert-value-input.svelte';

const settings: InputSettings = {
	charEditing: 'input',
	textareaRows: 15,
	textareaCols: 40,
	charTextareaRows: 7,
	charTextareaCols: 40,
	longtextDoubleTextarea: true,
	limitChars: 50
};

function column(type: string, extra: Partial<FormColumn> = {}): FormColumn {
	return {
		...toColumnMeta({
			field: 'c',
			type,
			null: true,
			key: '',
			default: null,
			extra: '',
			comment: ''
		}),
		protected: false,
		defaultFunction: '',
		foreign: null,
		...extra
	};
}

const cell = (o: Partial<FormCell> = {}): FormCell => ({
	value: '',
	setValues: [],
	isNull: false,
	func: '',
	salt: '',
	...o
});

function props(c: FormColumn, cl = cell()) {
	const reactive = $state(cl);
	return {
		column: c,
		cell: reactive,
		name: 'v_0_0',
		fileName: 'u_0_0',
		settings
	};
}

describe('insert-value-input.svelte', () => {
	it('uses a number input for integers', async () => {
		const int = await render(InsertValueInput, props(column('int(11)')));
		const el = int.getByLabelText('Value of c').element() as HTMLInputElement;
		expect(el.type).toBe('number');
		expect(el.step).toBe('1');
	});

	it('uses the decimal scale as the number step', async () => {
		const dec = await render(InsertValueInput, props(column('decimal(10,3)')));
		expect((dec.getByLabelText('Value of c').element() as HTMLInputElement).step).toBe('0.001');
	});

	it('uses text inputs with a picker for dates and times', async () => {
		const screen = await render(InsertValueInput, props(column('datetime')));
		const el = screen.getByLabelText('Value of c').element() as HTMLInputElement;
		expect(el.type).toBe('text');
		await expect.element(screen.getByRole('button', { name: 'Pick c date' })).toBeVisible();
	});

	it('renders ENUM as radios', async () => {
		const en = await render(
			InsertValueInput,
			props(column("enum('small','large')"), cell({ value: 'large' }))
		);
		await expect.element(en.getByRole('radio', { name: 'small' })).toBeVisible();
		await expect.element(en.getByRole('radio', { name: 'large' })).toBeChecked();
	});

	it('renders SET as checkboxes', async () => {
		const set = await render(
			InsertValueInput,
			props(column("set('a','b','c')"), cell({ setValues: ['b'] }))
		);
		await expect.element(set.getByRole('checkbox', { name: 'b' })).toBeChecked();
		await expect.element(set.getByRole('checkbox', { name: 'a' })).not.toBeChecked();
		await set.getByRole('checkbox', { name: 'c' }).click();
		await expect.element(set.getByRole('checkbox', { name: 'c' })).toBeChecked();
	});

	it('uses a textarea for text and JSON, JSON is validated', async () => {
		const text = await render(InsertValueInput, props(column('text')));
		expect(text.getByLabelText('Value of c').element().tagName).toBe('TEXTAREA');
	});

	it('flags invalid JSON', async () => {
		const json = await render(InsertValueInput, props(column('json'), cell({ value: '{oops' })));
		expect(json.getByRole('alert').element().textContent).toContain('Invalid JSON');
	});

	it('accepts valid JSON', async () => {
		const ok = await render(InsertValueInput, props(column('json'), cell({ value: '{"a":1}' })));
		expect(ok.container.querySelector('[role=alert]')).toBeNull();
	});

	it('protected binary shows a notice and a file input, no text value', async () => {
		const screen = await render(InsertValueInput, {
			...props(column('blob', { protected: true })),
			size: 12
		});
		await expect.element(screen.getByText('Binary - do not edit (12 B)')).toBeVisible();
		expect(screen.container.querySelector('input[type=file]')).not.toBeNull();
		expect(screen.container.querySelector('textarea')).toBeNull();
	});

	it('unprotected blob offers hex text and an upload', async () => {
		const screen = await render(InsertValueInput, props(column('blob')));
		expect(screen.container.querySelector('textarea')).not.toBeNull();
		expect(screen.container.querySelector('input[type=file]')).not.toBeNull();
	});

	it('foreign key columns get a searchable dropdown of referenced values', async () => {
		const c = column('int', {
			foreign: {
				db: 'd',
				table: 'parent',
				column: 'id',
				options: [
					{ value: '1', label: 'one - 1' },
					{ value: '2', label: 'two - 2' }
				]
			}
		});
		const screen = await render(InsertValueInput, props(c, cell({ value: '2' })));
		const combo = screen.getByRole('combobox', { name: 'Value of c' });
		await expect.element(combo).toHaveTextContent('two - 2');
		await combo.click();
		await screen.getByRole('option', { name: 'one - 1' }).click();
		await expect.element(combo).toHaveTextContent('one - 1');
		expect((screen.container.querySelector('input[type=hidden]') as HTMLInputElement).value).toBe(
			'1'
		);
	});

	it('falls back to a plain input when the referenced table is too big', async () => {
		const c = column('varchar(9)', {
			foreign: { db: 'd', table: 'p', column: 'id', options: null }
		});
		const screen = await render(InsertValueInput, props(c));
		const el = screen.getByLabelText('Value of c').element() as HTMLInputElement;
		expect(el.type).toBe('text');
	});

	it('is disabled while Null is checked', async () => {
		const screen = await render(
			InsertValueInput,
			props(column('varchar(10)'), cell({ isNull: true }))
		);
		await expect.element(screen.getByLabelText('Value of c')).toBeDisabled();
	});
});
