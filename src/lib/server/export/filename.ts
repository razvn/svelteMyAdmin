/**
 * Export file names: Util::expandUserString (strftime + `@SERVER@`-style tokens),
 * Sanitize::sanitizeFilename and Export::getFinalFilenameAndMimetypeForFilename.
 */

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
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const p2 = (n: number) => String(n).padStart(2, '0');

function dayOfYear(d: Date): number {
	const start = new Date(d.getFullYear(), 0, 0);
	return Math.floor(
		(d.getTime() - start.getTime() - (d.getTimezoneOffset() - start.getTimezoneOffset()) * 60_000) /
			86_400_000
	);
}

/** PHP `strftime` subset (local time), the conversions used in export file name templates. */
export function strftime(format: string, d: Date): string {
	return format.replace(/%([a-zA-Z%])/g, (all, c: string) => {
		switch (c) {
			case 'Y':
				return String(d.getFullYear());
			case 'y':
				return p2(d.getFullYear() % 100);
			case 'm':
				return p2(d.getMonth() + 1);
			case 'd':
				return p2(d.getDate());
			case 'e':
				return String(d.getDate()).padStart(2, ' ');
			case 'H':
				return p2(d.getHours());
			case 'I':
				return p2(d.getHours() % 12 || 12);
			case 'M':
				return p2(d.getMinutes());
			case 'S':
				return p2(d.getSeconds());
			case 'p':
				return d.getHours() < 12 ? 'AM' : 'PM';
			case 'P':
				return d.getHours() < 12 ? 'am' : 'pm';
			case 'B':
				return MONTHS[d.getMonth()];
			case 'b':
			case 'h':
				return MONTHS[d.getMonth()].slice(0, 3);
			case 'A':
				return DAYS[d.getDay()];
			case 'a':
				return DAYS[d.getDay()].slice(0, 3);
			case 'u':
				return String(d.getDay() || 7);
			case 'w':
				return String(d.getDay());
			case 'j':
				return String(dayOfYear(d)).padStart(3, '0');
			case 'D':
				return strftime('%m/%d/%y', d);
			case 'F':
				return strftime('%Y-%m-%d', d);
			case 'T':
				return strftime('%H:%M:%S', d);
			case 'R':
				return strftime('%H:%M', d);
			case 's':
				return String(Math.floor(d.getTime() / 1000));
			case 'n':
				return '\n';
			case 't':
				return '\t';
			case '%':
				return '%';
			default:
				return all;
		}
	});
}

export interface FilenameVars {
	/** Host name of the server (`@SERVER@`). */
	server: string;
	/** `verbose` of the server definition, '' when unset (`@VERBOSE@`). */
	verbose?: string;
	database?: string;
	table?: string;
	/** `@PHPMYADMIN@`, e.g. `svelteMyAdmin 0.0.1`. */
	app?: string;
	host?: string;
}

/**
 * Expand a filename template: first strftime, then the `@TOKEN@` replacements (phpMyAdmin applies
 * them in this order so values containing `%` are never interpreted).
 */
export function expandUserString(template: string, vars: FilenameVars, now = new Date()): string {
	const replace: Record<string, string> = {
		'@HTTP_HOST@': vars.host ?? '',
		'@SERVER@': vars.server,
		__SERVER__: vars.server,
		'@VERBOSE@': vars.verbose ?? '',
		'@VSERVER@': vars.verbose || vars.server,
		'@DATABASE@': vars.database ?? '',
		__DB__: vars.database ?? '',
		'@TABLE@': vars.table ?? '',
		__TABLE__: vars.table ?? '',
		'@PHPMYADMIN@': vars.app ?? ''
	};
	const expanded = strftime(template, now);
	return expanded.replace(
		/@HTTP_HOST@|@SERVER@|__SERVER__|@VERBOSE@|@VSERVER@|@DATABASE@|__DB__|@TABLE@|__TABLE__|@PHPMYADMIN@/g,
		(token) => replace[token]
	);
}

/** Sanitize::sanitizeFilename(..., true): everything except `[A-Za-z0-9_-]` becomes `_` (dots too). */
export function sanitizeFilename(name: string): string {
	return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

export type Compression = 'none' | 'gzip' | 'zip';

/** The final download name and media type for a (sanitized) base name. */
export function finalFilename(
	base: string,
	extension: string,
	mimeType: string,
	compression: Compression
): { filename: string; mimeType: string } {
	const required = '.' + extension;
	let filename = base;
	if (!filename.toLowerCase().endsWith(required.toLowerCase())) filename += required;
	if (compression === 'gzip') return { filename: filename + '.gz', mimeType: 'application/x-gzip' };
	if (compression === 'zip') return { filename: filename + '.zip', mimeType: 'application/zip' };
	return { filename, mimeType };
}

/** Full pipeline used by the export endpoint: template -> sanitized -> extension/compression. */
export function exportFilename(
	template: string,
	vars: FilenameVars,
	extension: string,
	mimeType: string,
	compression: Compression,
	now = new Date()
): { filename: string; mimeType: string } {
	const sanitized = sanitizeFilename(expandUserString(template, vars, now)) || 'export';
	return finalFilename(sanitized, extension, mimeType, compression);
}
