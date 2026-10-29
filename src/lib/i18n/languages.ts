/**
 * Language registry: metadata only. Which languages are actually *available* is decided by the catalog
 * folders under `locales/` (see `catalog.ts`), so adding a language = add one line here (if it is not
 * listed yet) + drop `locales/<code>/<area>.json`. Pure module (no Vite/Svelte imports): it is also used
 * by the Node scripts in `scripts/i18n`.
 */

export interface Language {
	/** Catalog folder name and cookie value (BCP 47 style: `fr`, `pt-BR`, `zh-CN`). */
	code: string;
	/** Name in the language itself. */
	native: string;
	/** English name. */
	english: string;
	dir: 'ltr' | 'rtl';
	/** Locale passed to `Intl.*` (number/date formatting, plural rules). */
	intl: string;
	/** Folder name in phpMyAdmin's `locale/` directory when it differs from `code`. */
	pma?: string;
}

const l = (
	code: string,
	native: string,
	english: string,
	extra: Partial<Pick<Language, 'dir' | 'intl' | 'pma'>> = {}
): Language => ({ code, native, english, dir: 'ltr', intl: code, ...extra });

/** Every language phpMyAdmin 5.2.3 ships (plus the English source). */
export const LANGUAGES: readonly Language[] = [
	l('en', 'English', 'English'),
	l('ar', 'العربية', 'Arabic', { dir: 'rtl' }),
	l('az', 'Azərbaycanca', 'Azerbaijani'),
	l('be', 'Беларуская', 'Belarusian'),
	l('bg', 'Български', 'Bulgarian'),
	l('bn', 'বাংলা', 'Bangla'),
	l('ca', 'Català', 'Catalan'),
	l('cs', 'Čeština', 'Czech'),
	l('da', 'Dansk', 'Danish'),
	l('de', 'Deutsch', 'German'),
	l('el', 'Ελληνικά', 'Greek'),
	l('en-GB', 'English (United Kingdom)', 'English (United Kingdom)', { pma: 'en_GB' }),
	l('es', 'Español', 'Spanish'),
	l('et', 'Eesti', 'Estonian'),
	l('fi', 'Suomi', 'Finnish'),
	l('fr', 'Français', 'French'),
	l('gl', 'Galego', 'Galician'),
	l('he', 'עברית', 'Hebrew', { dir: 'rtl' }),
	l('hu', 'Magyar', 'Hungarian'),
	l('hy', 'Հայերեն', 'Armenian'),
	l('ia', 'Interlingua', 'Interlingua'),
	l('id', 'Bahasa Indonesia', 'Indonesian'),
	l('it', 'Italiano', 'Italian'),
	l('ja', '日本語', 'Japanese'),
	l('ka', 'ქართული', 'Georgian'),
	l('kk', 'Қазақша', 'Kazakh'),
	l('ko', '한국어', 'Korean'),
	l('nb', 'Norsk bokmål', 'Norwegian'),
	l('nl', 'Nederlands', 'Dutch'),
	l('pl', 'Polski', 'Polish'),
	l('pt', 'Português', 'Portuguese'),
	l('pt-BR', 'Português (Brasil)', 'Portuguese (Brazil)', { pma: 'pt_BR' }),
	l('ro', 'Română', 'Romanian'),
	l('ru', 'Русский', 'Russian'),
	l('si', 'සිංහල', 'Sinhala'),
	l('sk', 'Slovenčina', 'Slovak'),
	l('sl', 'Slovenščina', 'Slovenian'),
	l('sq', 'Shqip', 'Albanian'),
	l('sv', 'Svenska', 'Swedish'),
	l('ta', 'தமிழ்', 'Tamil'),
	l('tr', 'Türkçe', 'Turkish'),
	l('ug', 'ئۇيغۇرچە', 'Uyghur', { dir: 'rtl' }),
	l('uk', 'Українська', 'Ukrainian'),
	l('vi', 'Tiếng Việt', 'Vietnamese'),
	l('zh-CN', '简体中文', 'Chinese simplified', { pma: 'zh_CN' }),
	l('zh-TW', '繁體中文', 'Chinese traditional', { pma: 'zh_TW' })
];

/** The source language: msgids are English, it never needs a catalog. */
export const SOURCE_LANG = 'en';
export const DEFAULT_LANG = 'en';

/** Cookie holding the explicit language choice. */
export const LANG_COOKIE = 'sma_lang';

const byKey = new Map(LANGUAGES.map((x) => [x.code.toLowerCase(), x]));

/** `pt_br` / `PT-br` -> registry entry, or undefined. */
export function findLanguage(code: string | null | undefined): Language | undefined {
	if (!code) return undefined;
	return byKey.get(code.trim().replace(/_/g, '-').toLowerCase());
}

/** Registry entry for a code, English when unknown. */
export function languageInfo(code: string): Language {
	return findLanguage(code) ?? LANGUAGES[0];
}

/** Label for language selects: "Français (French)", "English". */
export function languageLabel(lang: Pick<Language, 'native' | 'english'>): string {
	return lang.native === lang.english ? lang.native : `${lang.native} (${lang.english})`;
}
