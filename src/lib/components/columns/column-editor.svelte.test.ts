import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ServerCaps } from '#lib/sql/column-definition.ts';
import Host from './testing/column-editor-host.svelte';

const mysql: ServerCaps = { serverType: 'MySQL', version: 80404 };
const maria: ServerCaps = { serverType: 'MariaDB', version: 110406 };

const rows = (screen: Awaited<ReturnType<typeof render>>) =>
	screen.getByRole('group', { name: /^Column \d+$/ }).elements();

/** Poll the preview SQL (whitespace normalised) until it contains the fragment. */
const expectSql = (screen: Awaited<ReturnType<typeof render>>, part: string | RegExp) =>
	expect
		.poll(() => (screen.getByTestId('sql').element().textContent ?? '').replace(/\s+/g, ' '))
		.toSatisfy((t: string) => (typeof part === 'string' ? t.includes(part) : part.test(t)));

describe('column-editor.svelte', () => {
	it('adds N columns, removes and reorders', async () => {
		const screen = await render(Host, { caps: mysql });
		expect(rows(screen)).toHaveLength(2);

		await screen.getByLabelText('Number of columns to add').fill('3');
		await screen.getByRole('button', { name: 'Add 3 column(s)' }).click();
		expect(rows(screen)).toHaveLength(5);

		await screen.getByRole('button', { name: 'Remove column 5' }).click();
		expect(rows(screen)).toHaveLength(4);

		await screen.getByRole('button', { name: 'Move column 1 down' }).click();
		const first = screen.getByRole('group', { name: 'Column 1' }).getByLabelText('Name');
		await expect.element(first).toHaveValue('c2');
		await expectSql(screen, /`c2` INT NOT NULL, `c1`/);

		await screen.getByRole('button', { name: 'Move column 2 up' }).click();
		await expect.element(first).toHaveValue('c1');
	});

	it('disables move/remove at the boundaries', async () => {
		const screen = await render(Host, { caps: mysql, initial: 1 });
		await expect.element(screen.getByRole('button', { name: 'Remove column 1' })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Move column 1 up' })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Move column 1 down' })).toBeDisabled();
	});

	it('A_I sets PRIMARY and the SQL follows', async () => {
		const screen = await render(Host, { caps: mysql, initial: 1 });
		const row = screen.getByRole('group', { name: 'Column 1' });
		await row.getByRole('checkbox', { name: 'A_I' }).click();
		await expect.element(row.getByRole('combobox', { name: 'Index' })).toHaveTextContent('PRIMARY');
		await expectSql(screen, /`c1` INT NOT NULL AUTO_INCREMENT, PRIMARY KEY \(`c1`\)/);
	});

	it('changes type from the grouped select', async () => {
		const screen = await render(Host, { caps: mysql, initial: 1 });
		const row = screen.getByRole('group', { name: 'Column 1' });
		await row.getByRole('combobox', { name: 'Type' }).click();
		await expect.element(screen.getByRole('option', { name: 'JSON' })).toBeVisible();
		expect(screen.getByRole('option', { name: 'UUID' }).elements()).toHaveLength(0);
		await screen.getByRole('option', { name: 'VARCHAR' }).click();
		await row.getByLabelText('Length/Values').fill('64');
		await expectSql(screen, '`c1` VARCHAR(64) NOT NULL');
	});

	it('offers UUID on MariaDB 11.4 only', async () => {
		const screen = await render(Host, { caps: maria, initial: 1 });
		await screen.getByRole('combobox', { name: 'Type' }).click();
		await expect.element(screen.getByRole('option', { name: 'UUID' })).toBeVisible();
	});

	it('edits ENUM values in the dialog', async () => {
		const screen = await render(Host, { caps: mysql, initial: 1 });
		const row = screen.getByRole('group', { name: 'Column 1' });
		await row.getByRole('combobox', { name: 'Type' }).click();
		await screen.getByRole('option', { name: 'ENUM' }).click();
		await row.getByRole('button', { name: 'Edit ENUM/SET values' }).click();
		await screen.getByLabelText('Value 1').fill('a');
		await screen.getByRole('button', { name: 'Add a value' }).click();
		await screen.getByLabelText('Value 2').fill("b'c");
		await screen.getByRole('button', { name: 'Go', exact: true }).click();
		await expect.element(row.getByLabelText('Length/Values')).toHaveValue("'a','b''c'");
		await expectSql(screen, "`c1` ENUM('a','b''c') NOT NULL");
	});

	it('shows the expression input for generated columns and hides the default', async () => {
		const screen = await render(Host, { caps: mysql, initial: 1 });
		const row = screen.getByRole('group', { name: 'Column 1' });
		await row.getByRole('combobox', { name: 'Virtuality' }).click();
		await screen.getByRole('option', { name: 'STORED' }).click();
		await row.getByLabelText('Expression').fill('1 + 1');
		await expectSql(screen, '`c1` INT AS (1 + 1) STORED NOT NULL');
		await expect.element(row.getByRole('combobox', { name: 'Default' })).toBeDisabled();
	});
});
