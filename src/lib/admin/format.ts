/**
 * Number, byte and duration formatting as phpMyAdmin does (Util::formatNumber, Util::formatByteDown,
 * Util::timespanFormat). Pure: no framework imports.
 */

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

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];

/** PHP number_format with "." decimals and "," thousands. */
export function numberFormat(value: number, decimals = 0): string {
	const fixed = Math.abs(value).toFixed(decimals);
	const [int, frac] = fixed.split('.');
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	const sign = value < 0 && Number(fixed) !== 0 ? '-' : '';
	return sign + grouped + (frac ? `.${frac}` : '');
}

/**
 * Formats `value` to `digitsLeft` integer digits and appends an SI prefix (123456789 -> "123,457 k").
 * With `digitsLeft` 0 only the thousands grouping is applied.
 */
export function formatNumber(
	value: number | string,
	digitsLeft = 3,
	digitsRight = 0,
	onlyDown = false,
	noTrailingZero = true
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

/** [value, unit] like Util::formatByteDown (`limes` 6, `comma` 0 by default). */
export function formatByteDown(
	value: number | string | null,
	limes = 6,
	comma = 0
): [string, string] | null {
	if (value === null || value === undefined) return null;
	let v = typeof value === 'string' ? Number(value) : value;
	if (!Number.isFinite(v)) return null;
	const dh = 10 ** comma;
	const li = 10 ** limes;
	let unit = BYTE_UNITS[0];
	for (let d = 6, ex = 15; d >= 1; d--, ex -= 3) {
		if (v >= li * 10 ** ex) {
			v = Math.round(v / (1024 ** d / dh)) / dh;
			unit = BYTE_UNITS[d];
			break;
		}
	}
	const out = unit !== BYTE_UNITS[0] ? formatNumber(v, 5, comma, true, false) : formatNumber(v, 0);
	return [out.trim(), unit];
}

/** "1.5 KiB" style string. */
export function formatBytes(value: number | string | null, limes = 3, comma = 1): string {
	const r = formatByteDown(value, limes, comma);
	return r ? `${r[0]} ${r[1]}` : '';
}

/** "1 days, 2 hours, 3 minutes and 4 seconds" (Util::timespanFormat). */
export function timespanFormat(totalSeconds: number): string {
	let seconds = Math.max(0, Math.floor(totalSeconds));
	const days = Math.floor(seconds / 86400);
	seconds -= days * 86400;
	const hours = Math.floor(seconds / 3600);
	seconds -= hours * 3600;
	const minutes = Math.floor(seconds / 60);
	seconds -= minutes * 60;
	return `${days} days, ${hours} hours, ${minutes} minutes and ${seconds} seconds`;
}

/** Truncate with an ellipsis. */
export function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}
