import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { buildAxis, toAxisData, type ScatterPoint } from './scatter.ts';
import ScatterChart from './scatter-chart.svelte';

function props(onselect?: (id: number) => void) {
	const xs = ['0', '5', '10'];
	const ys = ['100', '200', '300'];
	const points: ScatterPoint[] = xs.map((x, i) => ({
		id: i,
		x: Number(x),
		y: Number(ys[i]),
		tip: [
			{ name: 'x', value: x },
			{ name: 'y', value: ys[i] }
		]
	}));
	return {
		points,
		xAxis: buildAxis(toAxisData('linear', xs)),
		yAxis: buildAxis(toAxisData('linear', ys)),
		xTitle: 'price',
		yTitle: 'stock',
		onselect
	};
}

describe('scatter-chart.svelte', () => {
	it('draws one circle per point and labelled ticks on both axes', async () => {
		const screen = await render(ScatterChart, props());
		const root = screen.container;
		expect(root.querySelectorAll('circle[data-point]')).toHaveLength(3);
		const xTicks = [...root.querySelectorAll('[data-axis="x-tick"]')].map((e) => e.textContent);
		const yTicks = [...root.querySelectorAll('[data-axis="y-tick"]')].map((e) => e.textContent);
		expect(xTicks).toEqual(['0', '2', '4', '6', '8', '10']);
		expect(yTicks).toEqual(['100', '150', '200', '250', '300']);
	});

	it('places points by scale: larger x is further right, larger y is higher', async () => {
		const screen = await render(ScatterChart, props());
		const c = [...screen.container.querySelectorAll('circle[data-point]')].map((e) => ({
			x: Number(e.getAttribute('cx')),
			y: Number(e.getAttribute('cy'))
		}));
		expect(c[0].x).toBeLessThan(c[1].x);
		expect(c[1].x).toBeLessThan(c[2].x);
		expect(c[0].y).toBeGreaterThan(c[1].y);
		expect(c[1].y).toBeGreaterThan(c[2].y);
	});

	it('shows a tooltip with the row values on hover and reports clicks', async () => {
		const onselect = vi.fn();
		const screen = await render(ScatterChart, props(onselect));
		const point = screen.container.querySelector('circle[data-point="1"]')!;
		point.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
		await expect.element(screen.getByRole('tooltip')).toHaveTextContent('x: 5y: 200');
		point.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onselect).toHaveBeenCalledWith(1);
	});

	it('renders category and time axes with their labels', async () => {
		const screen = await render(ScatterChart, {
			points: [{ id: 0, x: 0, y: 1_000_000_000_000, tip: [] }],
			xAxis: buildAxis(toAxisData('category', ['draft', 'published'])),
			yAxis: buildAxis(toAxisData('time', ['1969-03-01', '1974-05-01'])),
			xTitle: 'status',
			yTitle: 'published_at'
		});
		const xTicks = [...screen.container.querySelectorAll('[data-axis="x-tick"]')].map(
			(e) => e.textContent
		);
		expect(xTicks).toEqual(['draft', 'published']);
		const yTicks = [...screen.container.querySelectorAll('[data-axis="y-tick"]')].map(
			(e) => e.textContent
		);
		expect(yTicks.length).toBeGreaterThan(1);
		expect(yTicks.every((t) => /^\d{4}(-\d{2})?/.test(t ?? ''))).toBe(true);
	});
});
