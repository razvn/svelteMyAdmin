import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { flushSync } from 'svelte';
import '../../../app.css';
import SqlEditor from './sql-editor.svelte';

type Inst = { format(): void; insertText(t: string): void; focus(): void };

async function mounted(props: Record<string, unknown>) {
	const screen = await render(SqlEditor, props as never);
	await expect.poll(() => document.querySelector('.cm-content')).not.toBeNull();
	return screen;
}
const doc = () => document.querySelector('.cm-content')!.textContent;

describe('sql-editor.svelte', () => {
	it('renders CodeMirror with the initial value and aria-label', async () => {
		await mounted({ value: 'SELECT 1', 'aria-label': 'Query' });
		expect(doc()).toBe('SELECT 1');
		expect(document.querySelector('.cm-content')!.getAttribute('aria-label')).toBe('Query');
		expect(document.querySelector('textarea')).toBeNull();
	});

	it('typing updates the bound value and calls onchange', async () => {
		const onchange = vi.fn();
		const props = $state({ value: '', onchange });
		const screen = await mounted(props);
		await screen.getByRole('textbox').click();
		await userEvent.keyboard('SELECT 2');
		await expect.poll(() => props.value).toBe('SELECT 2');
		expect(onchange).toHaveBeenLastCalledWith('SELECT 2');
	});

	it('external value changes reach the editor', async () => {
		const props = $state({ value: 'a' });
		await mounted(props);
		props.value = 'SELECT external';
		flushSync();
		await expect.poll(doc).toBe('SELECT external');
	});

	it('Ctrl/Cmd+Enter calls onrun', async () => {
		const onrun = vi.fn();
		const screen = await mounted({ value: 'SELECT 3', onrun });
		await screen.getByRole('textbox').click();
		const mod = /Mac/.test(navigator.platform) ? 'Meta' : 'Control';
		await userEvent.keyboard(`{${mod}>}{Enter}{/${mod}}`);
		expect(onrun).toHaveBeenCalledWith('SELECT 3');
	});

	it('format() reformats and insertText() inserts at the cursor', async () => {
		const props = $state({ value: 'select a from t' });
		const { component } = await render(SqlEditor, props as never);
		const inst = component as unknown as Inst;
		await expect.poll(() => document.querySelector('.cm-content')).not.toBeNull();
		inst.format();
		await expect.poll(() => props.value).toContain('SELECT');
		expect(props.value).toContain('\n');
		props.value = 'SELECT  FROM t';
		flushSync();
		await expect.poll(doc).toBe('SELECT  FROM t');
		inst.focus();
		await userEvent.keyboard('{Control>}{Home}{/Control}');
		for (let i = 0; i < 7; i++) await userEvent.keyboard('{ArrowRight}');
		inst.insertText('`id`');
		await expect.poll(() => props.value).toBe('SELECT `id` FROM t');
	});

	it('mirrors the value into a hidden input named after `name`', async () => {
		const props = $state({ value: 'SELECT 4', name: 'definition' });
		await mounted(props);
		const input = () =>
			document.querySelector<HTMLInputElement>('input[type=hidden][name=definition]');
		await expect.poll(() => input()?.value).toBe('SELECT 4');
		props.value = 'SELECT 5';
		flushSync();
		await expect.poll(() => input()?.value).toBe('SELECT 5');
	});

	it('follows the dark theme class', async () => {
		await mounted({ value: 'x' });
		const bg = () => getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor;
		document.documentElement.classList.remove('dark');
		const light = bg();
		document.documentElement.classList.add('dark');
		await expect.poll(bg).not.toBe(light);
		document.documentElement.classList.remove('dark');
	});

	it('shows lint diagnostics for unbalanced input', async () => {
		await mounted({ value: 'SELECT (1' });
		await expect.poll(() => document.querySelector('.cm-lintRange-error')).not.toBeNull();
	});
});
