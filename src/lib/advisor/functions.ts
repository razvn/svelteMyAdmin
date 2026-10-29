/** Functions registered by Advisor.php, plus PHP's vsprintf for the justification strings. */
import { formatByteDown, timespanFormat } from '#lib/format.ts';
import { ExpressionError, toStr, type ExpressionFunction, type Value } from './expression.ts';

function num(v: Value | undefined, dflt = 0): number {
	if (v === undefined || v === null) return dflt;
	if (typeof v === 'number') return v;
	if (typeof v === 'boolean') return v ? 1 : 0;
	if (Array.isArray(v)) return v.length ? 1 : 0;
	const n = parseFloat(v);
	return Number.isFinite(n) ? n : 0;
}

/** PHP round(): half away from zero. */
export function phpRound(n: number, precision = 0): number {
	const f = 10 ** precision;
	const x = Math.abs(n) * f;
	// Pre-rounding like PHP 5.3-8.3 avoids 1.005 -> 1.00.
	const r = Math.round(Number(x.toPrecision(15)));
	return (n < 0 ? -r : r) / f;
}

/** Advisor::byTime(): "10 per hour". */
export function byTime(num_: number, precision: number): string {
	let n = num_;
	let per: string;
	if (n >= 1) per = 'per second';
	else if (n * 60 >= 1) {
		n *= 60;
		per = 'per minute';
	} else if (n * 60 * 60 >= 1) {
		n *= 60 * 60;
		per = 'per hour';
	} else {
		n *= 24 * 60 * 60;
		per = 'per day';
	}
	const rounded = phpRound(n, precision);
	const text = rounded === 0 ? `<${10 ** -precision}` : String(rounded);
	return `${text} ${per}`;
}

/** PHP substr() (8.x semantics: out of range yields ''). */
export function phpSubstr(s: string, start: number, length?: number): string {
	const len = s.length;
	let from = Math.trunc(start);
	if (from < 0) from = Math.max(0, len + from);
	if (from > len) return '';
	let to = len;
	if (length !== undefined) {
		const l = Math.trunc(length);
		to = l < 0 ? len + l : from + l;
	}
	return to <= from ? '' : s.slice(from, Math.min(to, len));
}

/** `/pattern/flags` (PHP delimiters) -> RegExp. */
export function phpRegex(pattern: string): RegExp {
	const delim = pattern[0];
	const end = pattern.lastIndexOf(delim);
	if (!delim || /[\w\s\\]/.test(delim) || end <= 0) {
		throw new ExpressionError('preg_match(): Delimiter must not be alphanumeric, backslash or NUL');
	}
	const flags = [...pattern.slice(end + 1)].filter((f) => 'ims'.includes(f)).join('');
	try {
		return new RegExp(pattern.slice(1, end), flags + 'u');
	} catch {
		throw new ExpressionError('preg_match(): Compilation failed');
	}
}

export function buildFunctions(fired: (id: string) => boolean): Record<string, ExpressionFunction> {
	return {
		round: (n, precision) => phpRound(num(n), num(precision)),
		substr: (s, start, length) =>
			phpSubstr(toStr(s ?? null), num(start), length === undefined ? undefined : num(length)),
		preg_match: (pattern, subject) =>
			phpRegex(toStr(pattern ?? null)).test(toStr(subject ?? null)) ? 1 : 0,
		ADVISOR_bytime: (n, precision) => byTime(num(n), num(precision)),
		ADVISOR_timespanFormat: (s) => timespanFormat(Math.trunc(num(s))),
		ADVISOR_formatByteDown: (v, limes, comma) => {
			const r = formatByteDown(
				num(v),
				limes === undefined ? 6 : num(limes),
				comma === undefined ? 0 : num(comma)
			);
			return r ? r.join(' ') : '';
		},
		fired: (id) => (fired(toStr(id ?? null)) ? '1' : '0')
	};
}

/** PHP vsprintf for %s %d %f %% (with optional padding/precision and n$ positions). */
export function vsprintf(format: string, args: Value[]): string {
	let auto = 0;
	return format.replace(
		/%(?:(\d+)\$)?([-+ 0]|'.)*(\d+)?(?:\.(\d+))?([%sdfFeEuxXob])/g,
		(
			m,
			pos: string | undefined,
			_flag,
			width: string | undefined,
			prec: string | undefined,
			conv: string
		) => {
			if (conv === '%') return '%';
			const idx = pos ? Number(pos) - 1 : auto++;
			if (idx >= args.length) {
				throw new ExpressionError(`${idx + 1} arguments are required, ${args.length + 1} given`);
			}
			const a = args[idx];
			let out: string;
			switch (conv) {
				case 'd':
					out = String(Math.trunc(num(a)));
					break;
				case 'f':
				case 'F':
					out = num(a).toFixed(prec === undefined ? 6 : Number(prec));
					break;
				default:
					out = toStr(a);
					if (prec !== undefined) out = out.slice(0, Number(prec));
			}
			void m;
			return width ? out.padStart(Number(width)) : out;
		}
	);
}
