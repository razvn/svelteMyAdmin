import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { buildChart } from './builders.ts';
import Chart from './chart.svelte';

const base = {
	xValues: ['Dune', 'Emma', 'Ulysses'],
	series: [
		{ name: 'price', values: ['10', '20', '5'] },
		{ name: 'stock', values: ['3', '4', '8'] }
	]
};

describe('chart.svelte', () => {
	it('draws one bar per value and one legend entry per series', async () => {
		const screen = await render(Chart, {
			model: buildChart({ ...base, type: 'column', title: 'Books', xLabel: 'title' })
		});
		const root = screen.container;
		expect(root.querySelectorAll('[data-shape="rect"]')).toHaveLength(6);
		expect(root.querySelector('[data-testid="chart-title"]')?.textContent).toBe('Books');
		expect(root.querySelectorAll('[data-testid="chart-legend"] li')).toHaveLength(2);
		expect(root.querySelector('svg')?.getAttribute('data-chart-type')).toBe('column');
		const first = root.querySelector('[data-shape="rect"]')!;
		expect(first.getAttribute('aria-label')).toBe('Dune - price: 10');
	});

	it.each(['line', 'spline', 'area', 'timeline', 'scatter'] as const)(
		'renders a %s chart with points',
		async (type) => {
			const screen = await render(Chart, {
				model: buildChart({
					...base,
					type,
					xKind: type === 'timeline' || type === 'scatter' ? 'linear' : undefined,
					xValues: type === 'timeline' || type === 'scatter' ? ['1', '2', '3'] : base.xValues
				})
			});
			expect(screen.container.querySelectorAll('[data-shape="point"]').length).toBeGreaterThan(0);
		}
	);

	it('renders pie slices', async () => {
		const screen = await render(Chart, {
			model: buildChart({ ...base, type: 'pie', series: [base.series[0]] })
		});
		expect(screen.container.querySelectorAll('[data-shape="slice"]')).toHaveLength(3);
	});
});
