/**
 * pnpm i18n:extract [--prune] [--area=a,b] [--dry-run]
 *
 * Scans src for t()/tn()/tc()/N_() calls with literal strings and merges them into
 * src/lib/i18n/locales/<lang>/<area>.json (see areas.ts for the file -> area mapping): English gets the
 * source text, every other language gets the missing keys empty (or reuses an existing translation of the
 * same key from another area). Obsolete keys are kept unless --prune.
 */
import { extractAll, syncCatalogs } from './extract-lib.ts';
import { option, parseAreas } from './lib.ts';

const args = process.argv.slice(2);
const areas = parseAreas(option(args, 'area') ?? process.env.I18N_AREAS);
const extracted = extractAll();

for (const w of extracted.warnings) console.warn(`warning: ${w}`);

const stats = syncCatalogs(extracted, {
	areas,
	prune: args.includes('--prune'),
	dryRun: args.includes('--dry-run')
});

const total = areas.reduce((n, a) => n + extracted.byArea.get(a)!.size, 0);
console.log(`${total} message(s) in area(s): ${areas.join(', ')}`);
for (const [lang, n] of Object.entries(stats.added)) console.log(`  ${lang}: ${n} key(s) added`);
for (const [lang, n] of Object.entries(stats.obsolete)) {
	console.log(`  ${lang}: ${n} obsolete key(s) kept (use --prune to remove)`);
}
if (stats.pruned) console.log(`  ${stats.pruned} obsolete key(s) removed`);
console.log(
	stats.changedFiles.length ? `updated: ${stats.changedFiles.join(', ')}` : 'catalogs up to date'
);
