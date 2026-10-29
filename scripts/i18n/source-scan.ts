/**
 * Finds `t('...')`, `tn('...', '...', n)`, `tc('ctx', '...')` and `N_('...')` calls in source text.
 * A small hand-written scanner (no TypeScript/Svelte parser): it looks for the call name, then reads
 * string literals (single, double or template without `${}`; adjacent literals joined with `+`).
 * Calls whose message arguments are not literals are reported as warnings.
 */
import { CONTEXT_SEPARATOR } from './lib.ts';

export interface Found {
	/** Catalog key (`context\u0004msgid` for tc). */
	key: string;
	/** English plural, for tn. */
	plural?: string;
	line: number;
}
export interface ScanResult {
	found: Found[];
	warnings: Array<{ line: number; message: string }>;
}

const CALL = /(?<![\w$])(t|tn|tc|N_)\s*\(/g;

function lineOf(text: string, index: number): number {
	let n = 1;
	for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
	return n;
}

const ESCAPES: Record<string, string> = {
	n: '\n',
	t: '\t',
	r: '\r',
	b: '\b',
	f: '\f',
	v: '\v',
	'0': '\0'
};

/** Read one literal at `i` (after whitespace). Returns [value, indexAfter] or null. */
function readLiteral(text: string, start: number): [string, number] | null {
	const q = text[start];
	if (q !== "'" && q !== '"' && q !== '`') return null;
	let out = '';
	let i = start + 1;
	while (i < text.length) {
		const c = text[i];
		if (c === q) return [out, i + 1];
		if (q === '`' && c === '$' && text[i + 1] === '{') return null;
		if (c === '\n' && q !== '`') return null;
		if (c === '\\') {
			const n = text[i + 1];
			if (n === 'u' && text[i + 2] === '{') {
				const end = text.indexOf('}', i);
				out += String.fromCodePoint(parseInt(text.slice(i + 3, end), 16));
				i = end + 1;
			} else if (n === 'u') {
				out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
				i += 6;
			} else if (n === 'x') {
				out += String.fromCharCode(parseInt(text.slice(i + 2, i + 4), 16));
				i += 4;
			} else if (n === '\n') {
				i += 2;
			} else {
				out += ESCAPES[n] ?? n;
				i += 2;
			}
			continue;
		}
		out += c;
		i++;
	}
	return null;
}

const skipWs = (text: string, i: number) => {
	while (i < text.length && /\s/.test(text[i])) i++;
	return i;
};

/** A string expression: literals joined by `+`. Returns [value, indexAfter] or null. */
function readString(text: string, from: number): [string, number] | null {
	let i = skipWs(text, from);
	const first = readLiteral(text, i);
	if (!first) return null;
	let [value, next] = first;
	for (;;) {
		i = skipWs(text, next);
		if (text[i] !== '+') return [value, next];
		const more = readLiteral(text, skipWs(text, i + 1));
		if (!more) return null; // `'a' + variable`
		value += more[0];
		next = more[1];
	}
}

/** Is the match inside a `//` or `*` comment line (documentation examples)? */
function inLineComment(text: string, index: number): boolean {
	const start = text.lastIndexOf('\n', index - 1) + 1;
	return /^\s*(\/\/|\*|\/\*)/.test(text.slice(start, index));
}

function lineText(text: string, index: number): string {
	const start = text.lastIndexOf('\n', index - 1) + 1;
	const end = text.indexOf('\n', index);
	return text.slice(start, end < 0 ? undefined : end);
}

/** `// i18n-ignore` on a line skips it; `i18n-ignore-file` anywhere skips the whole file. */
export function scanSource(text: string): ScanResult {
	if (text.includes('i18n-ignore-file')) return { found: [], warnings: [] };
	const found: Found[] = [];
	const warnings: ScanResult['warnings'] = [];
	for (const m of text.matchAll(CALL)) {
		const name = m[1];
		const at = m.index!;
		if (inLineComment(text, at)) continue;
		// A definition (`function t(`) or a `{#each list as t (key)}` loop variable named like the function.
		if (/(function|\bas)\s+$/.test(text.slice(Math.max(0, at - 12), at))) continue;
		if (lineText(text, at).includes('i18n-ignore')) continue;
		const line = lineOf(text, at);
		const argStart = at + m[0].length;
		const a = readString(text, argStart);
		if (!a) {
			// `t()` with no args or a type position like `(t: Translator)`: ignore empty/identifier-only arg lists.
			const rest = text.slice(skipWs(text, argStart), skipWs(text, argStart) + 1);
			if (rest !== ')' && rest !== '') {
				warnings.push({ line, message: `${name}(...) first argument is not a string literal` });
			}
			continue;
		}
		if (name === 't' || name === 'N_') {
			// `t('id', 'Label', 2)`: a local helper that happens to be called `t`, not the i18n function
			// (its second argument is an object of params, never a literal).
			const after = skipWs(text, a[1]);
			if (text[after] === ',' && /['"`\d]/.test(text[skipWs(text, after + 1)] ?? '')) continue;
			found.push({ key: a[0], line });
			continue;
		}
		const comma = skipWs(text, a[1]);
		if (text[comma] !== ',') {
			warnings.push({ line, message: `${name}(...) needs a second argument` });
			continue;
		}
		const b = readString(text, comma + 1);
		if (!b) {
			warnings.push({ line, message: `${name}(...) second argument is not a string literal` });
			continue;
		}
		if (name === 'tc') found.push({ key: `${a[0]}${CONTEXT_SEPARATOR}${b[0]}`, line });
		else found.push({ key: a[0], plural: b[0], line });
	}
	return { found, warnings };
}
