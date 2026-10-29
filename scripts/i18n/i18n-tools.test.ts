import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { areaOf } from './areas.ts';
import { checkCatalogs } from './check-lib.ts';
import { foreignHtml, stripForeignHtml } from './lib.ts';
import { indexMo, lookup, mapPlural, normalisePrintf } from './import-lib.ts';
import { PMA_DIR } from './lib.ts';
import { compilePlural, parseMo } from './mo.ts';
import { scanSource } from './source-scan.ts';

describe('source scanner', () => {
	it('finds t, tn, tc and N_ calls with literals', () => {
		const src = `
			const a = t('Hello');
			const b = t("Say \\"hi\\" {name}", { name });
			const c = tn('{n} row', '{n} rows', count);
			const d = tc('menu', 'Export');
			const e = N_(\`Template\`);
			const f = t('a long ' + 'sentence');
			{t('It\\'s fine')}
		`;
		const keys = scanSource(src).found.map((f) => f.key);
		expect(keys).toEqual([
			'Hello',
			'Say "hi" {name}',
			'{n} row',
			'menu\u0004Export',
			'Template',
			'a long sentence',
			"It's fine"
		]);
		expect(scanSource(src).found[2].plural).toBe('{n} rows');
	});
	it('warns on non-literal arguments and ignores unrelated identifiers', () => {
		const r = scanSource(
			"t(label);\nt(`a ${b}`);\nconst split = 'x'; print('y'); format('z'); list.at('q');\n{#each a as t (t.id)}"
		);
		expect(r.found).toEqual([]);
		expect(r.warnings.map((w) => w.line)).toEqual([1, 2]);
	});
	it('ignores comments, definitions, local helpers named t and ignore markers', () => {
		const r = scanSource(
			"// t('commented')\n * t('doc')\nfunction t(a) {}\nt('id', 'Label', 2);\nt(x); // i18n-ignore\n"
		);
		expect(r.found).toEqual([]);
		expect(scanSource('// i18n-ignore-file\nt("x")').found).toEqual([]);
	});
});

describe('area mapping', () => {
	it.each([
		['src/routes/login/+page.svelte', 'shell'],
		['src/routes/(app)/+page.svelte', 'shell'],
		['src/lib/components/home/appearance-settings.svelte', 'shell'],
		['src/routes/(app)/server/databases/+page.svelte', 'server'],
		['src/routes/(app)/server/privileges/+page.svelte', 'admin'],
		['src/routes/(app)/server/settings/[form]/+page.svelte', 'admin'],
		['src/routes/(app)/server/status/monitor/+page.svelte', 'admin'],
		['src/routes/(app)/server/status/+page.svelte', 'server'],
		['src/routes/(app)/server/sql/+page.svelte', 'sql'],
		['src/routes/(app)/db/[db]/structure/+page.svelte', 'database'],
		['src/routes/(app)/db/[db]/export/+page.svelte', 'io'],
		['src/routes/(app)/db/[db]/table/[table]/browse/+page.svelte', 'table'],
		['src/routes/(app)/db/[db]/table/[table]/sql/+page.svelte', 'sql'],
		['src/routes/(app)/db/[db]/table/[table]/normalization/+page.svelte', 'admin'],
		['src/lib/components/import/import-result.svelte', 'io'],
		['src/lib/components/results/grid.svelte', 'table'],
		['src/lib/components/ui/button/button.svelte', 'common'],
		['src/lib/format.ts', 'common']
	])('%s -> %s', (path, area) => {
		expect(areaOf(path)).toBe(area);
	});
});

describe('plural expressions', () => {
	it('compiles gettext expressions', () => {
		const fr = compilePlural('n > 1');
		expect([fr(0), fr(1), fr(2)]).toEqual([0, 0, 1]);
		const ru = compilePlural(
			'n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2'
		);
		expect([ru(1), ru(3), ru(5), ru(11), ru(21)]).toEqual([0, 1, 2, 2, 0]);
	});
	it('rejects anything but arithmetic', () => {
		expect(() => compilePlural('process.exit()')).toThrow();
	});
	it('maps gettext forms onto CLDR categories', () => {
		// French: [one, many, other] <- gettext n > 1
		expect(mapPlural(['un', 'plusieurs'], 'fr', compilePlural('n > 1'))).toEqual([
			'un',
			'plusieurs',
			'plusieurs'
		]);
		expect(mapPlural(['one', 'many'], 'en', compilePlural('n != 1'))).toEqual(['one', 'many']);
	});
});

describe('printf normalisation', () => {
	it('numbers sequential and positional placeholders', () => {
		expect(normalisePrintf('%s of %d (100%%)')).toEqual({
			text: '\u0001 of \u0001 (100%)',
			slots: [1, 2],
			ok: true
		});
		expect(normalisePrintf('%2$s then %1$s').slots).toEqual([2, 1]);
		expect(normalisePrintf('%.2f').ok).toBe(false);
	});
});

const moPath = (lang: string) => join(PMA_DIR, 'locale', lang, 'LC_MESSAGES', 'phpmyadmin.mo');
const haveMo = existsSync(moPath('fr')) && existsSync(moPath('es'));

describe.skipIf(!haveMo)('phpMyAdmin .mo files', () => {
	const fr = parseMo(readFileSync(moPath('fr')));
	const es = parseMo(readFileSync(moPath('es')));
	const find = (mo: typeof fr, id: string) => mo.entries.find((e) => e.msgid === id && !e.context);

	it('parses headers and plural forms', () => {
		expect(fr.header['Content-Type']).toMatch(/UTF-8/i);
		expect(fr.pluralForms).toEqual({ nplurals: 2, expr: 'n > 1' });
		expect(es.pluralForms?.expr).toBe('n != 1');
		expect(fr.entries.length).toBeGreaterThan(3000);
	});
	it('reads known messages', () => {
		expect(find(fr, 'Databases')?.forms).toEqual(['Bases de données']);
		expect(find(es, 'Databases')?.forms).toEqual(['Bases de datos']);
	});
	it('reads plural entries', () => {
		const e = fr.entries.find((x) => x.msgid === '%1$d column has been dropped successfully.');
		expect(e?.plural).toBe('%1$d columns have been dropped successfully.');
		expect(e?.forms).toHaveLength(2);
	});
	it('rejects non-.mo input', () => {
		expect(() => parseMo(new Uint8Array(64))).toThrow(/magic/);
	});

	it('imports exact matches', () => {
		const idx = indexMo(fr);
		expect(lookup(idx, 'Databases', 'Databases', 'fr')).toBe('Bases de données');
		expect(lookup(idx, 'No such message at all', 'No such message at all', 'fr')).toBeUndefined();
	});
	it('maps printf placeholders to our named params', () => {
		const idx = indexMo(fr);
		// "Table %s has been dropped." style messages
		const sample = fr.entries.find(
			(e) => /^[^%]*%s[^%]*$/.test(e.msgid) && !e.plural && !e.context
		)!;
		const ours = sample.msgid.replace('%s', '{name}');
		const got = lookup(idx, ours, ours, 'fr') as string;
		expect(got).toContain('{name}');
		expect(got).not.toContain('%s');
	});
	it('maps plural entries onto CLDR forms with named params', () => {
		const idx = indexMo(fr);
		const got = lookup(
			idx,
			'{n} column has been dropped successfully.',
			['{n} column has been dropped successfully.', '{n} columns have been dropped successfully.'],
			'fr'
		) as string[];
		expect(got).toHaveLength(3); // fr: one, many, other
		expect(got[0]).toBe('{n} colonne a été supprimée avec succès.');
		expect(got[2]).toBe('{n} colonnes ont été supprimées avec succès.');
	});
	it('does not match plurals against singular messages', () => {
		const idx = indexMo(fr);
		const k = '{n} column has been dropped successfully.';
		expect(lookup(idx, k, k, 'fr')).toBeUndefined();
	});
});

describe('checkCatalogs', () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});
	function fixture(files: Record<string, object>) {
		const root = mkdtempSync(join(tmpdir(), 'i18n-'));
		dirs.push(root);
		for (const [path, data] of Object.entries(files)) {
			mkdirSync(join(root, path, '..'), { recursive: true });
			writeFileSync(join(root, path), JSON.stringify(data));
		}
		return root;
	}
	const en = {
		'en/common.json': {
			Hi: 'Hi',
			'Hello {name}': 'Hello {name}',
			'{n} row': ['{n} row', '{n} rows']
		}
	};

	it('passes a complete catalog', () => {
		const root = fixture({
			...en,
			'fr/common.json': {
				Hi: 'Salut',
				'Hello {name}': 'Bonjour {name}',
				'{n} row': ['Une ligne', '{n} lignes', '{n} lignes']
			},
			'es/common.json': {
				Hi: 'Hola',
				'Hello {name}': 'Hola {name}',
				'{n} row': ['{n} fila', '{n} filas', '{n} filas']
			}
		});
		const r = checkCatalogs({ root, areas: ['common'] });
		expect(r.errors).toEqual([]);
		expect(r.coverage.fr.common).toEqual({ total: 3, translated: 3 });
	});
	it('reports missing, empty and param mismatches for strict languages', () => {
		const root = fixture({
			...en,
			'fr/common.json': { Hi: '', 'Hello {name}': 'Bonjour {nom}', '{n} row': ['a', 'b'] },
			'es/common.json': {
				Hi: 'Hola',
				'Hello {name}': 'Hola {name}',
				'{n} row': ['{n} fila', '{n} filas', '{n} filas'],
				Extra: 'x'
			}
		});
		const r = checkCatalogs({ root, areas: ['common'] });
		expect(r.errors.join('\n')).toMatch(/fr\/common: "Hi" is empty/);
		expect(r.errors.join('\n')).toMatch(/params \{nom\} differ from English \{name\}/);
		expect(r.errors.join('\n')).toMatch(/expected 3 plural forms/);
		expect(r.warnings.join('\n')).toMatch(/"Extra" is obsolete/);
	});
	it('flags HTML absent from the English msgid, allows what the msgid has', () => {
		const root = fixture({
			'en/common.json': { Hi: 'Hi', 'See <b>this</b>': 'See <b>this</b>' },
			'fr/common.json': { Hi: '<b>Salut</b>&nbsp;!', 'See <b>this</b>': 'Voir <b>ceci</b>' },
			'es/common.json': { Hi: 'Hola', 'See <b>this</b>': 'Ver <b>esto</b>' }
		});
		const r = checkCatalogs({ root, areas: ['common'] });
		expect(r.errors).toHaveLength(1);
		expect(r.errors[0]).toMatch(/fr\/common: "Hi": HTML not in the English text: <b> &nbsp;/);
	});
	it('only measures coverage for non-strict languages', () => {
		const root = fixture({
			...en,
			'fr/common.json': {
				Hi: 'Salut',
				'Hello {name}': 'Bonjour {name}',
				'{n} row': ['a', 'b', 'c']
			},
			'es/common.json': { Hi: 'Hola', 'Hello {name}': 'Hola {name}', '{n} row': ['a', 'b', 'c'] },
			'de/common.json': { Hi: 'Hallo' }
		});
		const r = checkCatalogs({ root, areas: ['common'] });
		expect(r.errors).toEqual([]);
		expect(r.coverage.de.common).toEqual({ total: 3, translated: 1 });
	});
});

describe('the shipped catalogs', () => {
	it('are complete for fr and es and have consistent params', () => {
		const areas = process.env.I18N_AREAS?.split(',') as never;
		const r = checkCatalogs(areas ? { areas } : {});
		expect(r.errors).toEqual([]);
	});
});

describe('HTML stripping', () => {
	it('removes tags and decodes entities absent from the msgid', () => {
		expect(stripForeignHtml('<b>Ordonner</b> la table par', 'Alter table order by')).toBe(
			'Ordonner la table par'
		);
		expect(stripForeignHtml('a<br />b<br>c', 'abc')).toBe('a b c');
		expect(stripForeignHtml('1&nbsp;&amp;&#233;&#x41;', 'x')).toBe('1\u00a0&\u00e9A');
		expect(stripForeignHtml('<em>x</em> <code>y</code>', 'x y')).toBe('x y');
	});
	it('keeps markup the msgid contains', () => {
		const id = 'See <a href="u">docs</a> <b>now</b>';
		expect(stripForeignHtml('Voir <a href="u">docs</a> <b>vite</b> <i>ok</i>', id)).toBe(
			'Voir <a href="u">docs</a> <b>vite</b> ok'
		);
	});
	it('foreignHtml lists offending tags and entities', () => {
		expect(foreignHtml('<b>x</b>&nbsp;<i>y</i>', 'x <i>y</i>')).toEqual(['<b>', '&nbsp;']);
		expect(foreignHtml('plain', 'plain')).toEqual([]);
	});
});
