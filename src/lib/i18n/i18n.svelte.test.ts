import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { loadCatalog } from './catalog.ts';
import Harness from './testing/switch-harness.svelte';

describe('i18n in components', () => {
	it('re-renders translated strings when the locale changes, without a reload', async () => {
		const catalogs = { fr: await loadCatalog('fr'), es: await loadCatalog('es') };
		const screen = await render(Harness, { catalogs });
		await expect.element(screen.getByTestId('greeting')).toHaveTextContent('Log in');
		await expect.element(screen.getByTestId('count')).toHaveTextContent('1 row / 0 rows');
		// Appearance card (reference example) in English
		await expect.element(screen.getByText('Theme', { exact: true })).toBeVisible();

		await screen.getByRole('button', { name: 'to-fr' }).click();
		await expect.element(screen.getByTestId('greeting')).toHaveTextContent('Connexion');
		await expect.element(screen.getByText('Thème', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Langue', { exact: true })).toBeVisible();
		await expect.element(screen.getByTestId('theme-select')).toHaveTextContent('Système');

		await screen.getByRole('button', { name: 'to-es' }).click();
		await expect.element(screen.getByTestId('greeting')).toHaveTextContent('Iniciar sesión');
		await expect.element(screen.getByText('Idioma', { exact: true })).toBeVisible();

		await screen.getByRole('button', { name: 'to-en' }).click();
		await expect.element(screen.getByTestId('greeting')).toHaveTextContent('Log in');
	});
});
