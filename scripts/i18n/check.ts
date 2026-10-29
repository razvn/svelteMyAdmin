/**
 * pnpm i18n:check [--ci] [--area=a,b] [--strict=fr,es] [--warnings]
 *
 * Per-language coverage per area. With --ci (or CI=true) exits 1 when a strict language (default fr, es)
 * lacks a key or has an empty translation, or when a translation's {params} differ from the English ones.
 */
import { checkCatalogs, formatReport } from './check-lib.ts';
import { option, parseAreas } from './lib.ts';

const args = process.argv.slice(2);
const ci = args.includes('--ci') || process.env.CI === 'true';
const strict = option(args, 'strict')?.split(',');
const areas = parseAreas(option(args, 'area') ?? process.env.I18N_AREAS);
const result = checkCatalogs({ areas, strict });

console.log(formatReport(result));
if (args.includes('--warnings')) for (const w of result.warnings) console.warn(`warning: ${w}`);
else if (result.warnings.length)
	console.log(`${result.warnings.length} warning(s) (--warnings to list)`);
for (const e of result.errors.slice(0, 200)) console.error(`error: ${e}`);
if (result.errors.length > 200) console.error(`... and ${result.errors.length - 200} more`);
console.log(result.errors.length ? `${result.errors.length} error(s)` : 'catalogs OK');
if (ci && result.errors.length) process.exit(1);
