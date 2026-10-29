import { existsSync } from 'node:fs';
import {
	AREAS,
	LOCALES_DIR,
	SOURCE_LANG,
	STRICT_LANGS,
	isEmptyMessage,
	localeDirs,
	messageParams,
	pluralCount,
	readCatalog,
	type Area,
	type Message
} from './lib.ts';

export interface AreaCoverage {
	total: number;
	translated: number;
}

export interface CheckResult {
	/** lang -> area -> coverage */
	coverage: Record<string, Partial<Record<Area, AreaCoverage>>>;
	/** Problems that fail CI. */
	errors: string[];
	warnings: string[];
}

export interface CheckOptions {
	root?: string;
	areas?: readonly Area[];
	/** Languages that must be complete. Default: fr, es. */
	strict?: readonly string[];
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Compare every language with the English catalog. Errors: a strict language lacks a key or has an empty
 * translation; a translation's `{params}` differ from the English message (for plural forms: use a
 * subset of the English params, since e.g. French "Une ligne" legitimately omits `{n}`); wrong number of plural forms.
 */
export function checkCatalogs(opts: CheckOptions = {}): CheckResult {
	const root = opts.root ?? LOCALES_DIR;
	const areas = opts.areas ?? AREAS;
	const strict = new Set(opts.strict ?? STRICT_LANGS);
	const result: CheckResult = { coverage: {}, errors: [], warnings: [] };
	const langs = localeDirs(root).filter((l) => l !== SOURCE_LANG);
	for (const s of strict) {
		if (!existsSync(`${root}/${s}`)) result.errors.push(`${s}: catalog folder is missing`);
		else if (!langs.includes(s)) langs.push(s);
	}

	for (const area of areas) {
		const en = readCatalog(SOURCE_LANG, area, root);
		for (const lang of langs) {
			const cat = readCatalog(lang, area, root);
			const cov = ((result.coverage[lang] ??= {})[area] = { total: 0, translated: 0 });
			const must = strict.has(lang);
			const at = (k: string) => `${lang}/${area}: ${JSON.stringify(k)}`;

			for (const [key, src] of Object.entries(en)) {
				cov.total++;
				const have = cat[key] as Message | undefined;
				if (have === undefined) {
					if (must) result.errors.push(`${at(key)} is missing`);
					continue;
				}
				if (isEmptyMessage(have)) {
					if (must) result.errors.push(`${at(key)} is empty`);
					continue;
				}
				cov.translated++;
				if (Array.isArray(src) !== Array.isArray(have)) {
					result.errors.push(`${at(key)}: plural/singular shape differs from English`);
					continue;
				}
				if (Array.isArray(have)) {
					if (have.length !== pluralCount(lang)) {
						result.errors.push(
							`${at(key)}: expected ${pluralCount(lang)} plural forms, got ${have.length}`
						);
					}
					const allowed = new Set(messageParams(src));
					for (const form of have) {
						const extra = messageParams(form).filter((p) => !allowed.has(p));
						if (extra.length)
							result.errors.push(`${at(key)}: unknown param(s) {${extra.join('}, {')}}`);
					}
				} else if (!same(messageParams(have), messageParams(src as string))) {
					result.errors.push(
						`${at(key)}: params {${messageParams(have).join(', ')}} differ from English {${messageParams(src as string).join(', ')}}`
					);
				}
			}
			for (const key of Object.keys(cat)) {
				if (!(key in en))
					result.warnings.push(`${at(key)} is obsolete (not in the English catalog)`);
			}
		}
	}
	return result;
}

export function formatReport(r: CheckResult): string {
	const lines: string[] = [];
	const areas = AREAS;
	lines.push(
		['lang', ...areas, 'total'].map((x, i) => (i === 0 ? x.padEnd(7) : x.padStart(10))).join(' ')
	);
	for (const [lang, perArea] of Object.entries(r.coverage)) {
		let t = 0;
		let d = 0;
		const cells = areas.map((a) => {
			const c = perArea[a];
			if (!c) return '-';
			t += c.total;
			d += c.translated;
			return c.total ? `${c.translated}/${c.total}` : '-';
		});
		const pct = t ? `${Math.round((d / t) * 100)}%` : '-';
		lines.push(
			[lang.padEnd(7), ...cells.map((c) => c.padStart(10)), `${d}/${t} ${pct}`.padStart(10)].join(
				' '
			)
		);
	}
	return lines.join('\n');
}
