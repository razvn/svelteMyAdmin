import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './chart-grid.harness.svelte';

const titles = (root: Element) =>
	[...root.querySelectorAll('[data-testid="monitor-chart-title"]')].map((e) =>
		e.textContent?.trim()
	);

describe('monitor chart grid', () => {
	it('renders the charts, draws the one with data and shows a placeholder for the others', async () => {
		const screen = await render(Harness);
		const root = screen.container;
		expect(titles(root)).toEqual(['Questions (/s)', 'Connections / Processes', 'Traffic (KiB/s)']);
		expect(root.querySelectorAll('svg[data-chart-type="line"]')).toHaveLength(1);
		expect(root.textContent).toContain('Waiting for data');
		expect(root.querySelector('[data-chart-id="questions"]')?.getAttribute('data-samples')).toBe(
			'3'
		);
	});

	it('removes a chart', async () => {
		const screen = await render(Harness);
		await screen.getByRole('button', { name: 'Remove chart Traffic' }).click();
		expect(titles(screen.container)).toEqual(['Questions (/s)', 'Connections / Processes']);
	});

	it('reorders charts', async () => {
		const screen = await render(Harness);
		await screen.getByRole('button', { name: 'Move Questions later' }).click();
		expect(titles(screen.container)[0]).toBe('Connections / Processes');
	});

	it('adds a preset chart', async () => {
		const screen = await render(Harness);
		await screen.getByRole('button', { name: 'Add chart', exact: true }).first().click();
		await screen.getByLabelText('Preset chart').selectOptions('table_locks');
		await screen.getByTestId('add-chart-submit').click();
		await expect.poll(() => titles(screen.container)).toContain('Table locks (/s)');
		expect(titles(screen.container)).toHaveLength(4);
	});

	it('adds a custom chart from status variables', async () => {
		const screen = await render(Harness);
		await screen.getByRole('button', { name: 'Add chart', exact: true }).first().click();
		await screen.getByLabelText('Preset chart').selectOptions('custom');
		await screen.getByLabelText('Chart title').fill('Selects');
		await screen.getByLabelText('Status variable').fill('Com_select');
		await screen.getByTestId('add-variable').click();
		await expect.element(screen.getByTestId('chart-variables')).toHaveTextContent('Com_select');
		await screen.getByTestId('add-chart-submit').click();
		await expect.poll(() => titles(screen.container)).toContain('Selects');
	});

	it('refuses a custom chart without variables', async () => {
		const screen = await render(Harness);
		await screen.getByRole('button', { name: 'Add chart', exact: true }).first().click();
		await screen.getByLabelText('Preset chart').selectOptions('custom');
		await screen.getByLabelText('Chart title').fill('Empty');
		await screen.getByTestId('add-chart-submit').click();
		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('Add at least one status variable.');
		expect(titles(screen.container)).toHaveLength(3);
	});

	it('selects the whole range of a chart for log analysis', async () => {
		const screen = await render(Harness);
		await screen.getByRole('button', { name: 'Select whole range of Questions' }).click();
		await expect.element(screen.getByTestId('selected')).toHaveTextContent('questions:0-10000');
	});
});
