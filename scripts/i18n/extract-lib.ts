import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { areaOf } from './areas.ts';
import {
	AREAS,
	ROOT,
	SOURCE_LANG,
	catalogFile,
	emptyFor,
	isEmptyMessage,
	localeDirs,
	readCatalog,
	splitKey,
	writeCatalog,
	type Area,
	type Catalog,
	type Message
} from './lib.ts';
import { scanSource } from './source-scan.ts';

export interface Entry {
	key: string;
	plural?: string;
}

export interface Extracted {
	/** area -> key -> entry */
	byArea: Map<Area, Map<string, Entry>>;
	warnings: string[];
}

function* walk(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) yield* walk(full);
		else yield full;
	}
}

const SOURCE_FILE = /\.(svelte|ts)$/;
const TEST_FILE = /\.(test|spec|e2e)\.[jt]s$|\.d\.ts$/;

export function extractAll(root = ROOT): Extracted {
	const byArea = new Map<Area, Map<string, Entry>>(AREAS.map((a) => [a, new Map()]));
	const warnings: string[] = [];
	for (const file of walk(join(root, 'src'))) {
		if (!SOURCE_FILE.test(file) || TEST_FILE.test(file)) continue;
		const rel = relative(root, file).replace(/\\/g, '/');
		const { found, warnings: w } = scanSource(readFileSync(file, 'utf8'));
		const area = areaOf(rel);
		for (const x of w) warnings.push(`${rel}:${x.line}: ${x.message}`);
		const map = byArea.get(area)!;
		for (const f of found) {
			const prev = map.get(f.key);
			if (prev?.plural && f.plural && prev.plural !== f.plural) {
				warnings.push(`${rel}:${f.line}: "${f.key}" has two different plurals`);
			}
			map.set(f.key, { key: f.key, plural: f.plural ?? prev?.plural });
		}
	}
	return { byArea, warnings };
}

/** English catalog value: the text itself, or `[singular, plural]`. */
export const sourceMessage = (e: Entry): Message =>
	e.plural !== undefined ? [splitKey(e.key).msgid, e.plural] : splitKey(e.key).msgid;

export interface SyncStats {
	added: Record<string, number>;
	obsolete: Record<string, number>;
	pruned: number;
	changedFiles: string[];
}

/** Merge the extracted keys into every language's catalogs. */
export function syncCatalogs(
	extracted: Extracted,
	opts: { areas: readonly Area[]; prune: boolean; root?: string; dryRun?: boolean }
): SyncStats {
	const root = opts.root;
	const langs = [...new Set([SOURCE_LANG, ...localeDirs(root)])];
	const stats: SyncStats = { added: {}, obsolete: {}, pruned: 0, changedFiles: [] };

	// Translations already present in any area, to reuse for a key that is new in this one.
	const known = new Map<string, Message>();
	for (const lang of langs) {
		if (lang === SOURCE_LANG) continue;
		for (const area of AREAS) {
			for (const [k, v] of Object.entries(readCatalog(lang, area, root))) {
				if (!isEmptyMessage(v)) known.set(`${lang}\u0000${k}`, v);
			}
		}
	}

	for (const area of opts.areas) {
		const entries = extracted.byArea.get(area)!;
		for (const lang of langs) {
			const old = readCatalog(lang, area, root);
			const next: Catalog = {};
			for (const e of entries.values()) {
				const src = sourceMessage(e);
				if (lang === SOURCE_LANG) {
					next[e.key] = src;
					continue;
				}
				const have = old[e.key];
				const isPlural = Array.isArray(src);
				if (have !== undefined && Array.isArray(have) === isPlural) {
					next[e.key] = have;
					continue;
				}
				const reuse = known.get(`${lang}\u0000${e.key}`);
				if (reuse !== undefined && Array.isArray(reuse) === isPlural) next[e.key] = reuse;
				else next[e.key] = emptyFor(src, lang);
				stats.added[lang] = (stats.added[lang] ?? 0) + 1;
			}
			for (const k of Object.keys(old)) {
				if (entries.has(k)) continue;
				if (opts.prune) stats.pruned++;
				else {
					next[k] = old[k];
					stats.obsolete[lang] = (stats.obsolete[lang] ?? 0) + 1;
				}
			}
			if (opts.dryRun) continue;
			if (writeCatalog(lang, area, next, root))
				stats.changedFiles.push(`${lang}/${catalogFile(area)}`);
		}
	}
	return stats;
}
