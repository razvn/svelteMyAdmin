/** Shared helpers of the i18n tooling: catalog files on disk, areas, key helpers. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paramNames } from '../../src/lib/i18n/interpolate.ts';
import { LANGUAGES, SOURCE_LANG, languageInfo } from '../../src/lib/i18n/languages.ts';
import { pluralCategories } from '../../src/lib/i18n/plural.ts';
import { CONTEXT_SEPARATOR, type Catalog, type Message } from '../../src/lib/i18n/translator.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LOCALES_DIR = join(ROOT, 'src/lib/i18n/locales');
export const PMA_DIR = join(ROOT, '../phpMyAdmin-5_2_3');

/** Catalog files per language: `locales/<lang>/<area>.json`. */
export const AREAS = [
	'common',
	'shell',
	'server',
	'database',
	'table',
	'sql',
	'io',
	'admin'
] as const;
export type Area = (typeof AREAS)[number];

export { SOURCE_LANG, languageInfo, paramNames, pluralCategories, CONTEXT_SEPARATOR };
export type { Catalog, Message };

/** Languages that must be 100 % translated (CI): the ones we maintain. */
export const STRICT_LANGS = ['fr', 'es'];

export function localeDirs(root = LOCALES_DIR): string[] {
	if (!existsSync(root)) return [];
	const known = new Set(LANGUAGES.map((l) => l.code));
	return readdirSync(root, { withFileTypes: true })
		.filter((d) => d.isDirectory() && known.has(d.name))
		.map((d) => d.name)
		.sort();
}

/**
 * File name of an area's catalog. The `server` area is stored as `server-pages.json`: SvelteKit treats any module
 * named `server.*` as server-only and refuses to bundle it into the client (the catalogs are loaded in the browser).
 */
export const catalogFile = (area: string) => (area === 'server' ? 'server-pages' : area) + '.json';

export const catalogPath = (lang: string, area: string, root = LOCALES_DIR) =>
	join(root, lang, catalogFile(area));

export function readCatalog(lang: string, area: string, root = LOCALES_DIR): Catalog {
	const file = catalogPath(lang, area, root);
	if (!existsSync(file)) return {};
	return JSON.parse(readFileSync(file, 'utf8')) as Catalog;
}

/** Sorted, tab-indented, trailing newline: stable diffs. Returns true when the file changed. */
export function writeCatalog(lang: string, area: string, catalog: Catalog, root = LOCALES_DIR) {
	const sorted: Catalog = {};
	for (const k of Object.keys(catalog).sort()) sorted[k] = catalog[k];
	const text = JSON.stringify(sorted, null, '\t') + '\n';
	const file = catalogPath(lang, area, root);
	if (existsSync(file) && readFileSync(file, 'utf8') === text) return false;
	if (Object.keys(sorted).length === 0 && !existsSync(file)) return false;
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text);
	return true;
}

export const splitKey = (key: string): { context?: string; msgid: string } => {
	const i = key.indexOf(CONTEXT_SEPARATOR);
	return i < 0 ? { msgid: key } : { context: key.slice(0, i), msgid: key.slice(i + 1) };
};

/** Number of plural forms a language's array must have. */
export const pluralCount = (lang: string) => pluralCategories(languageInfo(lang).intl).length;

export const isEmptyMessage = (m: Message | undefined): boolean =>
	m === undefined || (Array.isArray(m) ? m.length === 0 || m.some((x) => !x) : m === '');

export const emptyFor = (reference: Message, lang: string): Message =>
	Array.isArray(reference) ? Array.from({ length: pluralCount(lang) }, () => '') : '';

/** All `{param}` names used by a message (union over plural forms). */
export const messageParams = (m: Message): string[] =>
	[...new Set((Array.isArray(m) ? m : [m]).flatMap((x) => paramNames(x)))].sort();

/** Area filter from `--area=a,b` (or the I18N_AREAS env var). */
export function parseAreas(arg: string | undefined): Area[] {
	if (!arg) return [...AREAS];
	const list = arg.split(',').map((s) => s.trim());
	for (const a of list)
		if (!(AREAS as readonly string[]).includes(a)) throw new Error(`Unknown area "${a}"`);
	return list as Area[];
}

export function option(args: string[], name: string): string | undefined {
	const pref = `--${name}=`;
	return args.find((a) => a.startsWith(pref))?.slice(pref.length);
}

const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
const ENTITY = /&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);/g;

/** HTML tag names and entities in a string (lower-cased tag names, entities verbatim). */
export function htmlTokens(s: string): { tags: Set<string>; entities: Set<string> } {
	return {
		tags: new Set([...s.matchAll(TAG)].map((m) => m[1].toLowerCase())),
		entities: new Set(s.match(ENTITY) ?? [])
	};
}

const NAMED_ENTITIES: Record<string, string> = {
	nbsp: '\u00a0',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	hellip: '\u2026',
	laquo: '\u00ab',
	raquo: '\u00bb'
};

/** HTML markup (tags, entities) of `translation` that the English `msgid` does not contain. */
export function foreignHtml(translation: string, msgid: string): string[] {
	const en = htmlTokens(msgid);
	const tr = htmlTokens(translation);
	return [
		...[...tr.tags].filter((t) => !en.tags.has(t)).map((t) => `<${t}>`),
		...[...tr.entities].filter((e) => !en.entities.has(e))
	];
}

/**
 * Remove HTML that phpMyAdmin puts in translations but our English message lacks: tags the msgid does not
 * use are dropped (`<br>` becomes a space), entities the msgid does not use are decoded.
 */
export function stripForeignHtml(translation: string, msgid: string): string {
	const en = htmlTokens(msgid);
	return translation
		.replace(TAG, (m, name: string) => {
			if (en.tags.has(name.toLowerCase())) return m;
			return name.toLowerCase() === 'br' ? ' ' : '';
		})
		.replace(ENTITY, (m) => {
			if (en.entities.has(m)) return m;
			const num = /^&#(x?)([0-9a-fA-F]+);$/.exec(m);
			if (num) return String.fromCodePoint(parseInt(num[2], num[1] ? 16 : 10));
			return NAMED_ENTITIES[m.slice(1, -1)] ?? m;
		});
}
