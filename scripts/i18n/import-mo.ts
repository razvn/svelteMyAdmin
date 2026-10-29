/**
 * pnpm i18n:import-mo <lang> [--overwrite] [--area=a,b] [--mo=path] [--list-missing]
 *
 * Fills empty translations of src/lib/i18n/locales/<lang>/<area>.json from phpMyAdmin's compiled
 * catalog (../phpMyAdmin-5_2_3/locale/<dir>/LC_MESSAGES/phpmyadmin.mo). Matching rules: see import-lib.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexMo, lookup } from './import-lib.ts';
import {
	PMA_DIR,
	SOURCE_LANG,
	isEmptyMessage,
	languageInfo,
	option,
	parseAreas,
	readCatalog,
	writeCatalog
} from './lib.ts';
import { parseMo } from './mo.ts';

const args = process.argv.slice(2);
const lang = args.find((a) => !a.startsWith('--'));
if (!lang || lang === SOURCE_LANG) {
	console.error(
		'usage: pnpm i18n:import-mo <lang> [--overwrite] [--area=a,b] [--mo=path] [--list-missing]'
	);
	process.exit(2);
}
const info = languageInfo(lang);
if (info.code !== lang) {
	console.error(`Unknown language "${lang}" (see src/lib/i18n/languages.ts)`);
	process.exit(2);
}

const moPath =
	option(args, 'mo') ?? join(PMA_DIR, 'locale', info.pma ?? lang, 'LC_MESSAGES', 'phpmyadmin.mo');
const index = indexMo(parseMo(readFileSync(moPath)));
const overwrite = args.includes('--overwrite');
const areas = parseAreas(option(args, 'area') ?? process.env.I18N_AREAS);

let total = 0;
let filled = 0;
let already = 0;
const missing: string[] = [];
console.log(`${lang}: ${moPath}`);
for (const area of areas) {
	const source = readCatalog(SOURCE_LANG, area);
	const current = readCatalog(lang, area);
	let areaTotal = 0;
	let areaDone = 0;
	let changed = false;
	for (const [key, src] of Object.entries(source)) {
		areaTotal++;
		const have = current[key];
		if (!overwrite && !isEmptyMessage(have)) {
			areaDone++;
			already++;
			continue;
		}
		const found = lookup(index, key, src, lang);
		if (found === undefined || isEmptyMessage(found)) {
			missing.push(`${area}: ${JSON.stringify(key)}`);
			current[key] = have ?? (Array.isArray(src) ? src.map(() => '') : '');
			continue;
		}
		current[key] = found;
		changed = true;
		filled++;
		areaDone++;
	}
	total += areaTotal;
	if (changed) writeCatalog(lang, area, current);
	if (areaTotal) console.log(`  ${area.padEnd(9)} ${areaDone}/${areaTotal} translated`);
}
console.log(
	`${lang}: ${filled} imported, ${already} already translated, ${missing.length} without a match (of ${total})`
);
if (args.includes('--list-missing')) for (const m of missing) console.log(`  missing ${m}`);
