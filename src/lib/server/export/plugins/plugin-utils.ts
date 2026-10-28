/**
 * Shared helpers for the text export plugins (csv, json, xml, latex, ...).
 *
 * Output is built from "pieces": JS strings for text (encoded by the framework through
 * `ctx.write`) and Buffers for binary cells. Binary values are written byte-for-byte, the way
 * phpMyAdmin writes raw binary values, so the escaping helpers below operate on bytes for Buffers
 * and on code units for strings. Both produce the same result for ASCII search strings.
 */
import type { ExportContext, ExportOption, ExportOptionValues } from '../types.ts';

export type Piece = string | Buffer;

/** `str_replace($search, $replacement, $subject)` for a single search string. */
export function replaceAll<T extends Piece>(subject: T, search: string, replacement: string): T {
	if (search === '' || subject.length === 0) return subject;
	if (typeof subject === 'string') return subject.split(search).join(replacement) as T;
	const needle = Buffer.from(search, 'utf8');
	const repl = Buffer.from(replacement, 'utf8');
	let at = subject.indexOf(needle, 0);
	if (at === -1) return subject;
	const parts: Buffer[] = [];
	let start = 0;
	while (at !== -1) {
		parts.push(subject.subarray(start, at), repl);
		start = at + needle.length;
		at = subject.indexOf(needle, start);
	}
	parts.push(subject.subarray(start));
	return Buffer.concat(parts) as T;
}

/** `htmlspecialchars()` with PHP 8 defaults (ENT_QUOTES, ENT_HTML401); `double` = ENT_COMPAT. */
export function htmlEscape<T extends Piece>(subject: T, quotes: 'all' | 'double' = 'all'): T {
	let out = replaceAll(subject, '&', '&amp;');
	out = replaceAll(out, '<', '&lt;');
	out = replaceAll(out, '>', '&gt;');
	out = replaceAll(out, '"', '&quot;');
	return quotes === 'all' ? replaceAll(out, "'", '&#039;') : out;
}

/** phpMyAdmin's `Util::escapeLaTeX`-style `texEscape()`: prefixes `$ % { } & # _ ^` with a backslash. */
export function texEscape<T extends Piece>(subject: T): T {
	let out = subject;
	for (const char of ['$', '%', '{', '}', '&', '#', '_', '^']) {
		out = replaceAll(out, char, '\\' + char);
	}
	return out;
}

/** Backquote an identifier like phpMyAdmin's `Util::backquote()` (doubles embedded backquotes). */
export function backquote(name: string): string {
	return '`' + name.replaceAll('`', '``') + '`';
}

/** Text of a piece for header-like values that are always text (names, comments). */
export function pieceText(piece: Piece): string {
	return typeof piece === 'string' ? piece : piece.toString('utf8');
}

/**
 * Write pieces to the export. Adjacent strings are merged into one `write`, Buffers are written
 * as raw bytes.
 */
export async function emit(ctx: ExportContext, pieces: readonly Piece[]): Promise<void> {
	let text = '';
	for (const piece of pieces) {
		if (typeof piece === 'string') {
			text += piece;
			continue;
		}
		if (text !== '') {
			await ctx.write(text);
			text = '';
		}
		if (piece.length > 0) await ctx.write(piece);
	}
	if (text !== '') await ctx.write(text);
}

/** Characters trimmed by PHP's `trim()`. */
// eslint-disable-next-line no-control-regex
const PHP_TRIM_START = /^[ \t\n\r\0\x0B]+/;
// eslint-disable-next-line no-control-regex
const PHP_TRIM_END = /[ \t\n\r\0\x0B]+$/;

/** PHP's `trim()`. */
export function phpTrim(value: string): string {
	return value.replace(PHP_TRIM_START, '').replace(PHP_TRIM_END, '');
}

/** PHP's `rtrim()`. */
export function phpRtrim(value: string): string {
	return value.replace(PHP_TRIM_END, '');
}

/** PHP's `is_numeric()` for strings (leading and trailing whitespace allowed, no hex). */
const PHP_NUMERIC = /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/;
export function isPhpNumeric(value: string): boolean {
	return PHP_NUMERIC.test(value);
}

/** `ucfirst()` (ASCII only, like PHP 8). */
export function ucfirst(value: string): string {
	return value.replace(/^[a-z]/, (char) => char.toUpperCase());
}

/** `bin2hex()` with the `0x` prefix the JSON and SQL exports use for binary values. */
export function hexLiteral(buffer: Buffer): string {
	return '0x' + buffer.toString('hex');
}

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/** phpMyAdmin's default `Util::localisedDate()` format (`%B %d, %Y at %I:%M %p`), in English. */
export function localisedDate(date: Date): string {
	const pad = (n: number): string => String(n).padStart(2, '0');
	const hours = date.getHours();
	const hours12 = hours % 12 === 0 ? 12 : hours % 12;
	return (
		`${MONTHS[date.getMonth()]} ${pad(date.getDate())}, ${date.getFullYear()} at ` +
		`${pad(hours12)}:${pad(date.getMinutes())} ${hours < 12 ? 'AM' : 'PM'}`
	);
}

export type OptionScalar = string | number | boolean;
export type ResolvedOptions = Record<string, OptionScalar>;

/** Resolve plugin option values against their definitions, falling back to the defaults. */
export function resolveOptions(
	definitions: readonly ExportOption[],
	values: ExportOptionValues
): ResolvedOptions {
	const resolved: ResolvedOptions = {};
	for (const definition of definitions) {
		const raw = values[definition.name];
		if (raw === undefined) {
			resolved[definition.name] = definition.default;
			continue;
		}
		if (definition.kind === 'bool') {
			resolved[definition.name] =
				raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 'on';
		} else if (definition.kind === 'number') {
			resolved[definition.name] = Number(raw);
		} else {
			resolved[definition.name] = String(raw);
		}
	}
	return resolved;
}

export const optString = (options: ResolvedOptions, name: string): string =>
	String(options[name] ?? '');

export const optBool = (options: ResolvedOptions, name: string): boolean => options[name] === true;
