/**
 * Number/byte formatting ported from phpMyAdmin's Util::formatNumber() / Util::formatByteDown().
 * Output is English by default; pass a `LocaleFormat` (see `useI18n().fmt`, built from the active catalog
 * like phpMyAdmin's `__(',')` / `__('.')` / `__('KiB')`) to localise separators and units.
 */

export interface LocaleFormat {
	/** `Intl` locale for dates. */
	locale: string;
	/** Thousands separator (phpMyAdmin `__(',')`). */
	thousands: string;
	/** Decimal separator (phpMyAdmin `__('.')`). */
	decimal: string;
	/** Byte units B, KiB, MiB, GiB, TiB, PiB, EiB. */
	units: readonly string[];
	/** Duration sentence; defaults to the English one. */
	timespan?: (days: number, hours: number, minutes: number, seconds: number) => string;
}

export const EN_FORMAT: LocaleFormat = {
	locale: 'en',
	thousands: ',',
	decimal: '.',
	units: ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']
};

/** Swap the English `,` and `.` of a formatted number for the locale's separators. */
function localize(text: string, lf: LocaleFormat): string {
	if (lf.thousands === ',' && lf.decimal === '.') return text;
	return text.replace(/[,.]/g, (c) => (c === ',' ? lf.thousands : lf.decimal));
}

/** PHP `round()`: half away from zero. */
function phpRound(n: number): number {
	return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Integer with thousands separators, like `number_format($v, 0)`. */
export function formatNumber(
	value: number | string | null | undefined,
	lf: LocaleFormat = EN_FORMAT
): string {
	const n = Number(value ?? 0);
	if (!Number.isFinite(n) || n === 0) return '0';
	return localize(phpRound(n).toLocaleString('en-US', { maximumFractionDigits: 0 }), lf);
}

/**
 * Util::formatByteDown(): returns `[value, unit]` or null for null input.
 * `limes` = digits before switching to the next unit, `comma` = decimals.
 * The databases page uses `(3, 1)`: 16384 -> ["16.0", "KiB"].
 */
export function formatByteDown(
	value: number | string | null | undefined,
	limes = 6,
	comma = 0,
	lf: LocaleFormat = EN_FORMAT
): [string, string] | null {
	if (value === null || value === undefined) return null;
	let v = Number(value);
	if (!Number.isFinite(v)) v = 0;
	const dh = 10 ** comma;
	const li = 10 ** limes;
	let unit = lf.units[0];
	let scaled = false;
	for (let d = 6, ex = 15; d >= 1; d--, ex -= 3) {
		if (v >= li * 10 ** ex) {
			v = phpRound(v / (1024 ** d / dh)) / dh;
			unit = lf.units[d];
			scaled = true;
			break;
		}
	}
	if (!scaled) return [formatNumber(v, lf), unit];
	// formatNumber(v, 5, comma, onlyDown = true, noTrailingZero = false): v is below 1000 here
	// except for huge EiB values, which are only grouped.
	const text = v.toLocaleString('en-US', {
		minimumFractionDigits: comma,
		maximumFractionDigits: comma
	});
	return [localize(text, lf), unit];
}

/** `formatByteDown` joined with a space: "16.0 KiB". */
export function formatBytes(
	value: number | string | null | undefined,
	limes = 3,
	comma = 1,
	lf: LocaleFormat = EN_FORMAT
): string {
	const r = formatByteDown(value, limes, comma, lf);
	return r ? `${r[0]} ${r[1]}` : '';
}

// --- SI-prefix formatting (Util::formatNumber with digitsLeft/digitsRight) and misc ---

const SI_UNITS: Record<number, string> = {
	[-8]: 'y',
	[-7]: 'z',
	[-6]: 'a',
	[-5]: 'f',
	[-4]: 'p',
	[-3]: 'n',
	[-2]: 'µ',
	[-1]: 'm',
	0: ' ',
	1: 'k',
	2: 'M',
	3: 'G',
	4: 'T',
	5: 'P',
	6: 'E',
	7: 'Z',
	8: 'Y'
};

/** PHP number_format with "." decimals and "," thousands. */
export function numberFormat(value: number, decimals = 0, lf: LocaleFormat = EN_FORMAT): string {
	const fixed = Math.abs(value).toFixed(decimals);
	const [int, frac] = fixed.split('.');
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	const sign = value < 0 && Number(fixed) !== 0 ? '-' : '';
	return localize(sign + grouped + (frac ? `.${frac}` : ''), lf);
}

/**
 * Formats `value` to `digitsLeft` integer digits and appends an SI prefix (123456789 -> "123,457 k").
 * With `digitsLeft` 0 only the thousands grouping is applied.
 */
export function formatSi(
	value: number | string,
	digitsLeft = 3,
	digitsRight = 0,
	onlyDown = false,
	noTrailingZero = true,
	lf: LocaleFormat = EN_FORMAT
): string {
	return localize(formatSiEn(value, digitsLeft, digitsRight, onlyDown, noTrailingZero), lf);
}

function formatSiEn(
	value: number | string,
	digitsLeft: number,
	digitsRight: number,
	onlyDown: boolean,
	noTrailingZero: boolean
): string {
	let v = typeof value === 'string' ? Number(value) : value;
	if (!Number.isFinite(v) || v === 0) return '0';
	const original = v;

	if (digitsLeft === 0) {
		const out = numberFormat(v, digitsRight);
		return original !== 0 && Number(out.replace(/,/g, '')) === 0
			? ` <${1 / 10 ** digitsRight}`
			: out;
	}

	const sign = v < 0 ? '-' : '';
	v = Math.abs(v);
	const dh = 10 ** digitsRight;
	let d = Math.floor(Math.log10(v) / 3);
	const curDigits = Math.floor(Math.log10(v / 1000 ** d) + 1);
	if (digitsLeft > curDigits) d -= Math.floor((digitsLeft - curDigits) / 3);
	if (d < 0 && onlyDown) d = 0;
	d = Math.max(-8, Math.min(8, d));

	const rounded = Math.round(v / (1000 ** d / dh)) / dh;
	const unit = SI_UNITS[d];
	let formatted = numberFormat(rounded, digitsRight);
	if (noTrailingZero && formatted.includes('.')) formatted = formatted.replace(/\.?0+$/, '');
	if (rounded === 0) return ` <${numberFormat(1 / dh, digitsRight)} ${unit}`;
	return `${sign}${formatted} ${unit}`;
}

/** "1 days, 2 hours, 3 minutes and 4 seconds" (Util::timespanFormat). */
export function timespanFormat(totalSeconds: number, lf: LocaleFormat = EN_FORMAT): string {
	let seconds = Math.max(0, Math.floor(totalSeconds));
	const days = Math.floor(seconds / 86400);
	seconds -= days * 86400;
	const hours = Math.floor(seconds / 3600);
	seconds -= hours * 3600;
	const minutes = Math.floor(seconds / 60);
	seconds -= minutes * 60;
	return (
		lf.timespan?.(days, hours, minutes, seconds) ??
		`${days} days, ${hours} hours, ${minutes} minutes and ${seconds} seconds`
	);
}

/** Truncate with an ellipsis. */
export function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Compact duration for KPI cards: "3d 4h", "5h 12m", "42s". */
export function formatUptimeShort(totalSeconds: number): string {
	const seconds = Math.max(0, Math.floor(totalSeconds));
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

// --- Dates (Intl: localised month/day names and ordering) ---

type DateInput = Date | number | string;
type DateStyle = 'short' | 'medium' | 'long' | 'full';

const toDate = (v: DateInput): Date => (v instanceof Date ? v : new Date(v));

/** Localised date, e.g. "29 oct. 2026" (fr, medium). Invalid dates give an empty string. */
export function formatDate(
	value: DateInput,
	lf: LocaleFormat | string = EN_FORMAT,
	style: DateStyle = 'medium'
): string {
	const d = toDate(value);
	if (Number.isNaN(d.getTime())) return '';
	return new Intl.DateTimeFormat(typeof lf === 'string' ? lf : lf.locale, {
		dateStyle: style
	}).format(d);
}

/** Localised date and time. */
export function formatDateTime(
	value: DateInput,
	lf: LocaleFormat | string = EN_FORMAT,
	style: DateStyle = 'medium'
): string {
	const d = toDate(value);
	if (Number.isNaN(d.getTime())) return '';
	return new Intl.DateTimeFormat(typeof lf === 'string' ? lf : lf.locale, {
		dateStyle: style,
		timeStyle: style === 'full' || style === 'long' ? 'medium' : 'short'
	}).format(d);
}

/** Localised month names (index 0 = January). */
export function monthNames(
	lf: LocaleFormat | string = EN_FORMAT,
	width: 'long' | 'short' = 'long'
): string[] {
	const f = new Intl.DateTimeFormat(typeof lf === 'string' ? lf : lf.locale, {
		month: width,
		timeZone: 'UTC'
	});
	return Array.from({ length: 12 }, (_, m) => f.format(new Date(Date.UTC(2024, m, 15))));
}
