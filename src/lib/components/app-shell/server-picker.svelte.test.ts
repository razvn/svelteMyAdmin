import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { hydration } from '#lib/hooks/hydration.svelte.ts';
import ServerPicker from './server-picker.svelte';

// Twelve review environments: enough to make the select long, all pointing at made-up hosts.
const servers = Array.from({ length: 12 }, (_, i) => {
	const n = i + 1;
	const pad = String(n).padStart(2, '0');
	return { index: n, label: `review-${pad}`, host: `db${pad}.review.test`, port: 3300 + n };
});

const hiddenServerValue = () =>
	(document.querySelector('input[name="server"]') as HTMLInputElement | null)?.value;

const optionLabels = () =>
	Array.from(document.querySelectorAll('[role="option"]')).map((el) => el.textContent?.trim());

async function openSelect(screen: Awaited<ReturnType<typeof render>>) {
	await screen.getByRole('combobox').click();
}

describe('server-picker.svelte', () => {
	beforeEach(() => {
		// The filter toggle is disabled until hydration (it is JS-only); the component tests hydrate by hand.
		hydration.ready = true;
	});

	afterEach(() => {
		hydration.ready = false;
	});

	it('shows the filter toggle with a name and keeps the filter hidden by default', async () => {
		const screen = await render(ServerPicker, {
			id: 'server',
			name: 'server',
			servers,
			value: '1'
		});
		await expect.element(screen.getByRole('button', { name: 'Filter servers' })).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Filter servers' }))
			.toHaveAttribute('aria-expanded', 'false');
		expect(document.querySelector('input[type="search"]')).toBeNull();
	});

	it('hides the toggle for a single server', async () => {
		const screen = await render(ServerPicker, {
			id: 'server',
			name: 'server',
			servers: servers.slice(0, 1),
			value: '1'
		});
		await expect.element(screen.getByRole('combobox')).toBeVisible();
		expect(document.querySelector('button[aria-label="Filter servers"]')).toBeNull();
	});

	it('is disabled until hydrated', async () => {
		hydration.ready = false;
		const screen = await render(ServerPicker, {
			id: 'server',
			name: 'server',
			servers,
			value: '1'
		});
		await expect.element(screen.getByRole('button', { name: 'Filter servers' })).toBeDisabled();
	});

	it('opens the filter from the keyboard and focuses it', async () => {
		const screen = await render(ServerPicker, {
			id: 'server',
			name: 'server',
			servers,
			value: '1'
		});
		const toggle = screen.getByRole('button', { name: 'Filter servers' }).element() as HTMLElement;
		toggle.focus();
		await userEvent.keyboard('{Enter}');
		const input = screen.getByPlaceholder('Filter servers…');
		await expect.element(input).toBeVisible();
		await expect
			.poll(() => (document.activeElement as HTMLElement | null)?.getAttribute('placeholder'))
			.toBe('Filter servers…');
		await expect
			.element(screen.getByRole('button', { name: 'Filter servers' }))
			.toHaveAttribute('aria-expanded', 'true');
	});

	it('filters the options case-insensitively by label', async () => {
		const screen = await render(ServerPicker, {
			id: 'server',
			name: 'server',
			servers,
			value: '1'
		});
		await screen.getByRole('button', { name: 'Filter servers' }).click();
		await screen.getByPlaceholder('Filter servers…').fill('REVIEW-07');
		await openSelect(screen);
		await expect.poll(optionLabels).toEqual(['review-07']);
	});

	it('also matches the host and the port', async () => {
		const screen = await render(ServerPicker, {
			id: 'server',
			name: 'server',
			servers,
			value: '1'
		});
		await screen.getByRole('button', { name: 'Filter servers' }).click();
		const input = screen.getByPlaceholder('Filter servers…');

		await input.fill('db12.review');
		await openSelect(screen);
		await expect.poll(optionLabels).toEqual(['review-12']);
		await userEvent.keyboard('{Escape}');

		await input.fill('3311');
		await openSelect(screen);
		await expect.poll(optionLabels).toEqual(['review-11']);
		await userEvent.keyboard('{Escape}');

		await input.fill('db01.review.test:3301');
		await openSelect(screen);
		await expect.poll(optionLabels).toEqual(['review-01']);
	});

	it('moves the selection to the first match when the selected server is filtered out', async () => {
		const screen = await render(ServerPicker, {
			id: 'server',
			name: 'server',
			servers,
			value: '1'
		});
		expect(hiddenServerValue()).toBe('1');
		await screen.getByRole('button', { name: 'Filter servers' }).click();
		await screen.getByPlaceholder('Filter servers…').fill('review-09');
		await expect.poll(hiddenServerValue).toBe('9');
		await expect.element(screen.getByRole('combobox')).toHaveTextContent('review-09');
	});

	it('keeps the selection when it still matches', async () => {
		const screen = await render(ServerPicker, {
			id: 'server',
			name: 'server',
			servers,
			value: '5'
		});
		await screen.getByRole('button', { name: 'Filter servers' }).click();
		await screen.getByPlaceholder('Filter servers…').fill('review-05');
		await expect.poll(hiddenServerValue).toBe('5');
	});

	it('shows a muted hint when nothing matches and keeps the selection', async () => {
		const screen = await render(ServerPicker, {
			id: 'server',
			name: 'server',
			servers,
			value: '1'
		});
		await screen.getByRole('button', { name: 'Filter servers' }).click();
		await screen.getByPlaceholder('Filter servers…').fill('nothing-here');
		await expect.element(screen.getByRole('status')).toHaveTextContent('No server matches');
		expect(hiddenServerValue()).toBe('1');
	});

	it('Escape clears the filter, hides it and returns focus to the toggle', async () => {
		const screen = await render(ServerPicker, {
			id: 'server',
			name: 'server',
			servers,
			value: '1'
		});
		await screen.getByRole('button', { name: 'Filter servers' }).click();
		const input = screen.getByPlaceholder('Filter servers…');
		await input.fill('review-03');
		await userEvent.keyboard('{Escape}');

		expect(document.querySelector('input[type="search"]')).toBeNull();
		await expect
			.poll(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label'))
			.toBe('Filter servers');
		await openSelect(screen);
		await expect.poll(() => optionLabels().length).toBe(12);
	});

	it('does not add a filter value to the form', async () => {
		const screen = await render(ServerPicker, {
			id: 'server',
			name: 'server',
			servers,
			value: '1'
		});
		await screen.getByRole('button', { name: 'Filter servers' }).click();
		const input = screen.getByPlaceholder('Filter servers…').element() as HTMLInputElement;
		expect(input.name).toBe('');
	});
});
