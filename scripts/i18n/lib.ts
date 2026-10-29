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

export const catalogPath = (lang: string, area: string, root = LOCALES_DIR) =>
	join(root, lang, `${area}.json`);

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
