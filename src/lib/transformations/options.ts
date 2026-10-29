/**
 * Transformation options: phpMyAdmin's comma separated, optionally single-quoted format
 * (Transformations::getOptions) and the default merging of TransformationsPlugin::getOptions.
 */

const PHP_WS = ' \t\n\r\0\x0B';

function trim(s: string): string {
	let a = 0;
	let b = s.length;
	while (a < b && PHP_WS.includes(s[a])) a++;
	while (b > a && PHP_WS.includes(s[b - 1])) b--;
	return s.slice(a, b);
}
const ltrim = (s: string): string => {
	let a = 0;
	while (a < s.length && PHP_WS.includes(s[a])) a++;
	return s.slice(a);
};
const rtrim = (s: string): string => {
	let b = s.length;
	while (b > 0 && PHP_WS.includes(s[b - 1])) b--;
	return s.slice(0, b);
};

/** Strip the outer characters (mb_substr($s, 1, -1)). */
const unwrap = (s: string): string => Array.from(s).slice(1, -1).join('');

/** PHP stripslashes(): `\\` -> `\`, `\0` -> NUL, other `\x` -> `x`, a trailing `\` is dropped. */
export function stripslashes(s: string): string {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		if (s[i] !== '\\') {
			out += s[i];
			continue;
		}
		i++;
		if (i < s.length) out += s[i] === '0' ? '\0' : s[i];
	}
	return out;
}

/**
 * Port of Transformations::getOptions: `'option ,, quoted',abd,'2,3',` becomes
 * `['option ,, quoted', 'abd', '2,3', '']`.
 */
export function getOptions(optionString: string): string[] {
	if (optionString.length === 0) return [];
	const parts = optionString.split(',');
	const result: string[] = [];
	let option: string | undefined;
	while ((option = parts.shift()) !== undefined) {
		const trimmed = trim(option);
		if (trimmed.length > 1 && trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'") {
			option = unwrap(trimmed);
		} else if (trimmed.length > 0 && trimmed[0] === "'") {
			let acc = ltrim(option);
			let rtrimmed = '';
			let next: string | undefined;
			while ((next = parts.shift()) !== undefined) {
				acc += ',' + next;
				rtrimmed = rtrim(acc);
				if (rtrimmed[rtrimmed.length - 1] === "'") break;
			}
			option = unwrap(rtrimmed);
		}
		result.push(stripslashes(option));
	}
	return result;
}

export type OptionDefault = string | number | null;

/**
 * TransformationsPlugin::getOptions: the result has one entry per default; a given option wins
 * unless it is missing or the empty string.
 */
export function withDefaults(options: string[], defaults: OptionDefault[]): (string | null)[] {
	return defaults.map((d, i) => {
		const given = options[i];
		return given !== undefined && given !== '' ? given : d === null ? null : String(d);
	});
}

/** PHP intval() of an option. */
export function intval(v: string | null | undefined): number {
	const m = /^\s*[+-]?\d+/.exec(v ?? '');
	return m ? Number.parseInt(m[0], 10) : 0;
}
