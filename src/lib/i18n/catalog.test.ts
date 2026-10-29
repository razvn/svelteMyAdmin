import { describe, expect, it } from 'vitest';
import { availableCodes, loadCatalog, loadTranslator } from './catalog.ts';
import { makeFmt } from './context.svelte.ts';
import { localeFormat } from './locale-format.ts';

describe('catalogs', () => {
	it('discovers languages from the locales folder', () => {
		expect(availableCodes()).toEqual(expect.arrayContaining(['en', 'fr', 'es']));
		expect(availableCodes()).not.toContain('de');
	});
	it('merges all area files of a language', async () => {
		const fr = await loadCatalog('fr');
		expect(fr['Language']).toBe('Langue'); // shell
		expect(fr['KiB']).toBe('kio'); // common
	});
	it('English and unknown languages have an empty catalog', async () => {
		expect(await loadCatalog('en')).toEqual({});
		expect(await loadCatalog('xx')).toEqual({});
	});
	it('translates through a loaded translator', async () => {
		const es = await loadTranslator('es');
		expect(es.t('Password')).toBe('Contraseña');
	});
});

describe('locale-aware formatting', () => {
	it('uses the catalog separators and units', async () => {
		const fr = makeFmt(localeFormat(await loadTranslator('fr')));
		expect(fr.number(1234567)).toBe('1 234 567'.replace(/ /g, fr.format.thousands));
		expect(fr.numberFormat(1234.5, 1)).toBe(`1${fr.format.thousands}234,5`);
		expect(fr.bytes(16384)).toBe('16,0 kio');
		const en = makeFmt(localeFormat(await loadTranslator('en')));
		expect(en.number(1234567)).toBe('1,234,567');
		expect(en.bytes(16384)).toBe('16.0 KiB');
	});
	it('formats dates with Intl', async () => {
		const fr = makeFmt(localeFormat(await loadTranslator('fr')));
		expect(fr.date(new Date(Date.UTC(2026, 9, 29, 12)), 'long')).toMatch(/29 octobre 2026/);
		expect(fr.monthNames()[0]).toBe('janvier');
	});
});
