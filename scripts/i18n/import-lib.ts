/**
 * Fills empty translations from a phpMyAdmin .mo file.
 *
 * Matching rules, in order, for every catalog key (`msgid`, or `context\u0004msgid`):
 *  1. Exact: the .mo has the same msgctxt + msgid. Translations are used verbatim.
 *  2. Placeholder-normalised: phpMyAdmin uses printf placeholders (`%s`, `%d`, `%1$s`, `%1$d`), we use
 *     named ones (`{name}`). Both sides are normalised by replacing every placeholder with the same marker;
 *     when the texts are then identical and unique, the entry matches. The placeholders of the translation
 *     are mapped to our names by *position in the msgid*: the k-th placeholder of the .mo msgid (`%s` = next
 *     sequential slot, `%N$s` = slot N) is the k-th `{name}` of our msgid in order of appearance.
 *     Not matched (left empty) when: our msgid repeats a name, the .mo uses a conversion other than
 *     `%s`/`%d` (e.g. `%.2f`, `%5s`), the .mo msgid is ambiguous after normalisation, or the translation uses
 *     a slot the msgid does not have.
 *  3. Plurals only match plurals (and the other way round). gettext forms are mapped onto CLDR categories
 *     by evaluating the file's Plural-Forms expression for a sample `n` of each category (plural.ts).
 */
import { languageInfo } from '../../src/lib/i18n/languages.ts';
import {
	CATEGORY_ORDER,
	pluralCategories,
	type PluralCategory
} from '../../src/lib/i18n/plural.ts';
import { compilePlural, type MoEntry, type MoFile } from './mo.ts';
import {
	CONTEXT_SEPARATOR,
	isEmptyMessage,
	splitKey,
	stripForeignHtml,
	type Message
} from './lib.ts';

const MARK = '\u0001';
const PLACEHOLDER = /%(?:(\d+)\$)?([sd])|%%|%[^a-zA-Z%\s]*[a-zA-Z]/g;
const NAMED = /\{(\w+)\}/g;

interface Normalised {
	/** Text with every placeholder replaced by MARK. */
	text: string;
	/** Slot (1-based) of each placeholder, in order. */
	slots: number[];
	/** False when an unsupported printf conversion appears. */
	ok: boolean;
}

/** Normalise a phpMyAdmin (printf-style) string. `%%` becomes a literal `%`. */
export function normalisePrintf(s: string): Normalised {
	let next = 1;
	const slots: number[] = [];
	let ok = true;
	const text = s.replace(PLACEHOLDER, (m, idx: string | undefined, conv: string | undefined) => {
		if (m === '%%') return '%';
		if (!conv) {
			ok = false;
			return m;
		}
		slots.push(idx ? Number(idx) : next++);
		return MARK;
	});
	return { text, slots, ok };
}

/** Normalise one of our messages: `{name}` -> MARK; null when a name repeats. */
function normaliseNamed(s: string): { text: string; names: string[] } | null {
	const names: string[] = [];
	const text = s.replace(NAMED, (_m, n: string) => {
		names.push(n);
		return MARK;
	});
	return new Set(names).size === names.length ? { text, names } : null;
}

/** Rewrite a translation's printf placeholders to `{name}` using the msgid's slot -> name map. */
function renderTranslation(tr: string, slotName: Map<number, string>): string | null {
	const norm = normalisePrintf(tr);
	if (!norm.ok) return null;
	let k = 0;
	let missing = false;
	const out = norm.text.replace(new RegExp(MARK, 'g'), () => {
		const name = slotName.get(norm.slots[k++]);
		if (name === undefined) {
			missing = true;
			return '';
		}
		return `{${name}}`;
	});
	return missing ? null : out;
}

export interface MoIndex {
	exact: Map<string, MoEntry>;
	/** normalised key -> entries (more than one = ambiguous) */
	loose: Map<string, MoEntry[]>;
	pluralOf: (forms: string[], intl: string) => string[];
}

const keyOf = (e: MoEntry) =>
	e.context !== undefined ? `${e.context}${CONTEXT_SEPARATOR}${e.msgid}` : e.msgid;

export function indexMo(mo: MoFile): MoIndex {
	const exact = new Map<string, MoEntry>();
	const loose = new Map<string, MoEntry[]>();
	for (const e of mo.entries) {
		if (e.forms.every((f) => f === '')) continue;
		exact.set(keyOf(e), e);
		if (!/%/.test(e.msgid)) continue;
		const n = normalisePrintf(e.msgid);
		if (!n.ok) continue;
		const k = `${e.context ?? ''}${CONTEXT_SEPARATOR}${n.text}`;
		(loose.get(k) ?? loose.set(k, []).get(k)!).push(e);
	}
	const expr = mo.pluralForms
		? compilePlural(mo.pluralForms.expr)
		: (n: number) => (n === 1 ? 0 : 1);
	return { exact, loose, pluralOf: (forms, intl) => mapPlural(forms, intl, expr) };
}

/** gettext forms (indexed by the Plural-Forms expression) -> CLDR-ordered array for `intl`. */
export function mapPlural(forms: string[], intl: string, index: (n: number) => number): string[] {
	const cats = pluralCategories(intl);
	const rules = new Intl.PluralRules(intl);
	const pick = new Map<PluralCategory, string>();
	for (const c of cats) {
		for (let n = 0; n <= 2000; n++) {
			if ((rules.select(n) as PluralCategory) === c) {
				pick.set(c, forms[Math.min(index(n), forms.length - 1)]);
				break;
			}
		}
	}
	// Categories with no integer sample below 2000 (fr/es/pt `many`): same form as `other`.
	const other = pick.get('other') ?? forms[forms.length - 1];
	return cats.map((c) => pick.get(c) ?? other);
}

/**
 * Translation for a catalog key + its English value, or undefined when nothing matches safely.
 * HTML markup in the translation that the msgid does not contain is stripped (see `stripForeignHtml`).
 */
export function lookup(
	index: MoIndex,
	key: string,
	source: Message,
	lang: string
): Message | undefined {
	const found = lookupRaw(index, key, source, lang);
	if (found === undefined) return undefined;
	const { msgid } = splitKey(key);
	return Array.isArray(found)
		? found.map((f) => stripForeignHtml(f, msgid))
		: stripForeignHtml(found, msgid);
}

function lookupRaw(
	index: MoIndex,
	key: string,
	source: Message,
	lang: string
): Message | undefined {
	const intl = languageInfo(lang).intl;
	const isPlural = Array.isArray(source);
	const { context, msgid } = splitKey(key);

	const exact = index.exact.get(key);
	if (exact) {
		if (isPlural !== (exact.plural !== undefined)) return undefined;
		return isPlural ? index.pluralOf(exact.forms, intl) : exact.forms[0];
	}

	const ours = normaliseNamed(msgid);
	if (!ours || ours.names.length === 0) return undefined;
	const candidates = index.loose.get(`${context ?? ''}${CONTEXT_SEPARATOR}${ours.text}`);
	if (!candidates || candidates.length !== 1) return undefined;
	const e = candidates[0];
	if (isPlural !== (e.plural !== undefined)) return undefined;

	const slots = normalisePrintf(e.msgid).slots;
	if (slots.length !== ours.names.length) return undefined;
	const slotName = new Map(slots.map((s, i) => [s, ours.names[i]]));
	const forms = e.forms.map((f) => renderTranslation(f, slotName));
	if (forms.some((f) => f === null)) return undefined;
	const rendered = forms as string[];
	return isPlural ? index.pluralOf(rendered, intl) : rendered[0];
}

export { isEmptyMessage, CATEGORY_ORDER };
