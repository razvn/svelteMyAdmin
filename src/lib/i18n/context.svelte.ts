// i18n-ignore-file (wrappers around the translation functions)
import { createContext } from 'svelte';
import {
	formatBytes,
	formatByteDown,
	formatDate,
	formatDateTime,
	formatNumber,
	formatSi,
	monthNames,
	numberFormat,
	timespanFormat,
	type LocaleFormat
} from '#lib/format.ts';
import { languageInfo, type Language } from './languages.ts';
import { localeFormat } from './locale-format.ts';
import { SOURCE_TRANSLATOR, Translator, type Catalog } from './translator.ts';

/** What the root layout hands to the runtime. */
export interface I18nSource {
	locale: string;
	catalog: Catalog;
	/** Selectable languages (for language selects). */
	languages?: readonly Language[];
}

/**
 * Per-request/per-app i18n state, provided by the root layout through context (never a module-level
 * singleton: the server renders many users concurrently). Reads `source` reactively, so replacing the
 * layout data (language switch -> `refreshAll()`) re-renders every translated string without a reload.
 *
 * Destructure freely: `const { t, tn, tc, fmt } = useI18n()`.
 */
export class I18n {
	#source: () => I18nSource;
	#tr = $derived.by(() => {
		const s = this.#source();
		return new Translator(s.locale, s.catalog);
	});
	#fmt = $derived(makeFmt(localeFormat(this.#tr)));

	constructor(source: () => I18nSource) {
		this.#source = source;
	}

	get locale(): string {
		return this.#tr.locale;
	}
	get language(): Language {
		return languageInfo(this.#tr.locale);
	}
	get dir(): 'ltr' | 'rtl' {
		return this.language.dir;
	}
	get languages(): readonly Language[] {
		return this.#source().languages ?? [this.language];
	}

	t = (msgid: string, params?: Parameters<Translator['t']>[1]) => this.#tr.t(msgid, params);
	tc = (context: string, msgid: string, params?: Parameters<Translator['tc']>[2]) =>
		this.#tr.tc(context, msgid, params);
	tn = (singular: string, plural: string, n: number, params?: Parameters<Translator['tn']>[3]) =>
		this.#tr.tn(singular, plural, n, params);

	/** Locale-aware number, byte and date formatting. */
	get fmt(): Fmt {
		return this.#fmt;
	}
}

/** Formatting bound to one locale. */
export interface Fmt {
	format: LocaleFormat;
	number: (value: number | string | null | undefined) => string;
	numberFormat: (value: number, decimals?: number) => string;
	bytes: (value: number | string | null | undefined, limes?: number, comma?: number) => string;
	byteDown: (
		value: number | string | null | undefined,
		limes?: number,
		comma?: number
	) => [string, string] | null;
	si: (
		value: number | string,
		digitsLeft?: number,
		digitsRight?: number,
		onlyDown?: boolean,
		noTrailingZero?: boolean
	) => string;
	timespan: (totalSeconds: number) => string;
	date: (value: Date | number | string, style?: 'short' | 'medium' | 'long' | 'full') => string;
	dateTime: (value: Date | number | string, style?: 'short' | 'medium' | 'long' | 'full') => string;
	monthNames: (width?: 'long' | 'short') => string[];
}

export function makeFmt(lf: LocaleFormat): Fmt {
	return {
		format: lf,
		number: (v) => formatNumber(v, lf),
		numberFormat: (v, d) => numberFormat(v, d, lf),
		bytes: (v, limes, comma) => formatBytes(v, limes, comma, lf),
		byteDown: (v, limes, comma) => formatByteDown(v, limes, comma, lf),
		si: (v, l, r, down, trailing) => formatSi(v, l, r, down, trailing, lf),
		timespan: (s) => timespanFormat(s, lf),
		date: (v, style) => formatDate(v, lf, style),
		dateTime: (v, style) => formatDateTime(v, lf, style),
		monthNames: (w) => monthNames(lf, w)
	};
}

const [getContext, setContext] = createContext<I18n>();
export const setI18n = setContext;

/** English, catalog-less instance: what components get when no layout provided one (tests, error pages). */
const FALLBACK = new I18n(() => ({ locale: SOURCE_TRANSLATOR.locale, catalog: {} }));

/** The i18n of the current component tree; plain English when none was provided. */
export function useI18n(): I18n {
	try {
		return getContext();
	} catch {
		return FALLBACK;
	}
}
