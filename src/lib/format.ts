/** Number/byte formatting ported from phpMyAdmin's Util::formatNumber() / Util::formatByteDown() (en locale). */

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];

/** PHP `round()`: half away from zero. */
function phpRound(n: number): number {
	return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Integer with thousands separators, like `number_format($v, 0)`. */
export function formatNumber(value: number | string | null | undefined): string {
	const n = Number(value ?? 0);
	if (!Number.isFinite(n) || n === 0) return '0';
	return phpRound(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Util::formatByteDown(): returns `[value, unit]` or null for null input.
 * `limes` = digits before switching to the next unit, `comma` = decimals.
 * The databases page uses `(3, 1)`: 16384 -> ["16.0", "KiB"].
 */
export function formatByteDown(
	value: number | string | null | undefined,
	limes = 6,
	comma = 0
): [string, string] | null {
	if (value === null || value === undefined) return null;
	let v = Number(value);
	if (!Number.isFinite(v)) v = 0;
	const dh = 10 ** comma;
	const li = 10 ** limes;
	let unit = BYTE_UNITS[0];
	for (let d = 6, ex = 15; d >= 1; d--, ex -= 3) {
		if (v >= li * 10 ** ex) {
			v = phpRound(v / (1024 ** d / dh)) / dh;
			unit = BYTE_UNITS[d];
			break;
		}
	}
	if (unit === BYTE_UNITS[0]) return [formatNumber(v), unit];
	// formatNumber(v, 5, comma, onlyDown = true, noTrailingZero = false): v is below 1000 here
	// except for huge EiB values, which are only grouped.
	const text = v.toLocaleString('en-US', {
		minimumFractionDigits: comma,
		maximumFractionDigits: comma
	});
	return [text, unit];
}

/** `formatByteDown` joined with a space: "16.0 KiB". */
export function formatBytes(
	value: number | string | null | undefined,
	limes = 3,
	comma = 1
): string {
	const r = formatByteDown(value, limes, comma);
	return r ? `${r[0]} ${r[1]}` : '';
}
