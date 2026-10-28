/**
 * Column type guessing for imports that create tables (libraries/classes/Import.php:
 * detectType, detectSize, analyzeTable, getColumnAlphaName, buildSql CREATE TABLE part).
 *
 * Cells are strings; `null` and the literal `NULL` are SQL NULL. Differences from phpMyAdmin:
 * DATE detection is added, long VARCHARs become TEXT, INT/BIGINT have no display width.
 */

export const NONE = 0;
export const VARCHAR = 1;
export const INT = 2;
export const DECIMAL = 3;
export const BIGINT = 4;
export const GEOMETRY = 5;
export const DATE = 6;
export type CellType = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Cell = string | null;

const NUMERIC_RE = /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/;
const INT_RE = /^-?(0|[1-9]\d*)$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const INT32_MAX = 2147483647n;
const INT64_MAX = 9223372036854775807n;
/** VARCHAR longer than this becomes TEXT. */
export const MAX_VARCHAR = 255;

const isNull = (cell: Cell | undefined): boolean =>
	cell === null || cell === undefined || cell === 'NULL';

/** PHP `is_numeric` for strings. */
export function isNumeric(cell: string): boolean {
	return NUMERIC_RE.test(cell);
}

/** Type of one cell given the type accumulated so far (Import::detectType). */
export function detectType(last: CellType | null, cell: Cell | undefined): CellType {
	if (isNull(cell)) return last === null || last === NONE ? NONE : last;
	const c = cell as string;
	if (!isNumeric(c)) return DATE_RE.test(c) ? DATE : VARCHAR;
	if (c.includes('.') && c.split('.').length === 2) return DECIMAL;
	if (!INT_RE.test(c)) return VARCHAR; // 007, +5, 1e5, " 1"
	const n = BigInt(c);
	const abs = n < 0n ? -n : n;
	if (abs > INT64_MAX) return VARCHAR;
	return abs > INT32_MAX ? BIGINT : INT;
}

/** Size is a number (VARCHAR/INT/BIGINT/DATE) or a `"M,D"` string (DECIMAL). */
export type Size = number | string;

const decimalPrecision = (s: Size): number => parseInt(String(s).split(',')[0], 10) || 0;
const decimalScale = (s: Size): number => {
	const str = String(s);
	const k = str.indexOf(',');
	return k === -1 ? 0 : parseInt(str.slice(k + 1), 10) || 0;
};

/** `[M, D, "M,D"]` of a decimal cell. */
export function decimalSize(cell: string): [number, number, string] {
	const len = [...cell].length;
	const pos = cell.indexOf('.');
	const m = len - 1;
	const d = len - 1 - pos;
	return [m, d, `${m},${d}`];
}

/** Size after folding one more cell in (Import::detectSize); -1 is PHP's "error occurred". */
export function detectSize(
	lastSize: Size,
	lastType: CellType | null,
	currentType: CellType,
	cell: Cell | undefined
): Size {
	if (isNull(cell)) return lastSize;
	const c = cell as string;
	const curr = [...c].length;
	const none = lastType === null || lastType === NONE;
	// DATE cells behave like short strings.
	const t = currentType === DATE ? VARCHAR : currentType;
	const lt = lastType === DATE ? VARCHAR : lastType;

	if (t === VARCHAR) {
		if (lt === VARCHAR || lt === BIGINT || lt === INT)
			return curr >= Number(lastSize) ? curr : lastSize;
		if (lt === DECIMAL) {
			const oldM = decimalPrecision(lastSize);
			return curr >= oldM ? curr : oldM;
		}
		if (none) return curr;
		return -1;
	}
	if (t === DECIMAL) {
		if (lt === VARCHAR) {
			const [m] = decimalSize(c);
			return m >= Number(lastSize) ? m : lastSize;
		}
		if (lt === DECIMAL) {
			const [m, d] = decimalSize(c);
			const oldM = decimalPrecision(lastSize);
			const oldD = decimalScale(lastSize);
			if (m > oldM || d > oldD) return `${Math.max(m, oldM)},${Math.max(d, oldD)}`;
			return lastSize;
		}
		if (lt === BIGINT || lt === INT) {
			const [m, d, full] = decimalSize(c);
			return m >= Number(lastSize) ? full : `${lastSize},${d}`;
		}
		if (none) return decimalSize(c)[2];
		return -1;
	}
	if (t === BIGINT || t === INT) {
		if (lt === VARCHAR) return curr >= Number(lastSize) ? curr : lastSize;
		if (lt === DECIMAL) {
			const oldM = decimalPrecision(lastSize);
			const oldD = decimalScale(lastSize);
			const oldInt = oldM - oldD;
			if (oldInt >= curr) return lastSize;
			return `${curr + oldD},${oldD}`;
		}
		if (lt === BIGINT || lt === INT) return curr >= Number(lastSize) ? curr : lastSize;
		if (none) return curr;
		return -1;
	}
	return -1;
}

export interface Analysis {
	types: CellType[];
	sizes: Size[];
}

/** Best-fit type and size per column (Import::analyzeTable). */
export function analyzeTable(
	colNames: readonly string[],
	rows: readonly (readonly Cell[])[]
): Analysis {
	const types: CellType[] = colNames.map(() => NONE);
	const sizes: Size[] = colNames.map(() => 0);
	for (let i = 0; i < colNames.length; i++) {
		for (const row of rows) {
			const cell = row[i];
			const curr = detectType(types[i], cell);
			sizes[i] = detectSize(sizes[i], types[i], curr, cell);
			const prev = types[i];
			if (curr === NONE) continue;
			if (curr === VARCHAR) types[i] = VARCHAR;
			else if (curr === DATE) {
				// A date column stays DATE only while every non-null cell is a date.
				types[i] = prev === NONE || prev === DATE ? DATE : VARCHAR;
			} else if (curr === DECIMAL) {
				if (prev !== VARCHAR && prev !== DATE) types[i] = DECIMAL;
				else types[i] = VARCHAR;
			} else if (curr === BIGINT) {
				if (prev === DATE) types[i] = VARCHAR;
				else if (prev !== VARCHAR && prev !== DECIMAL) types[i] = BIGINT;
			} else if (curr === INT) {
				if (prev === DATE) types[i] = VARCHAR;
				else if (prev !== VARCHAR && prev !== DECIMAL && prev !== BIGINT) types[i] = INT;
			}
			// DATE merged into an earlier numeric type: it is text now (size counted as string above).
			if (curr === DATE && types[i] === VARCHAR && prev !== VARCHAR) {
				sizes[i] = Math.max(10, Number(sizes[i]) || 0);
			}
		}
	}
	for (let n = 0; n < types.length; n++) {
		if (types[n] !== NONE) continue;
		types[n] = VARCHAR;
		sizes[n] = '10';
	}
	return { types, sizes };
}

/** SQL type of an analysed column, e.g. `varchar(20)`, `decimal(5,2)`, `int`, `text`, `date`. */
export function columnType(type: CellType, size: Size): string {
	switch (type) {
		case INT:
			return 'int';
		case BIGINT:
			return 'bigint';
		case DATE:
			return 'date';
		case GEOMETRY:
			return 'geometry';
		case DECIMAL: {
			let m = decimalPrecision(size);
			const d = decimalScale(size);
			if (m <= 0) m = 10;
			// DECIMAL(M,D): M up to 65, D up to 30 and D <= M.
			return `decimal(${Math.min(65, Math.max(m, d))},${Math.min(30, d)})`;
		}
		default: {
			const n = Number(size) || 10;
			return n > MAX_VARCHAR ? 'text' : `varchar(${n})`;
		}
	}
}

/** Spreadsheet column letters: 1 => A, 27 => AA (Import::getColumnAlphaName). */
export function columnAlphaName(num: number): string {
	let out = '';
	let n = num;
	while (n > 0) {
		const rem = (n - 1) % 26;
		out = String.fromCharCode(65 + rem) + out;
		n = Math.floor((n - 1) / 26);
	}
	return out;
}

/** Inverse of `columnAlphaName` (Import::getColumnNumberFromName). */
export function columnNumberFromName(name: string): number {
	let n = 0;
	for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n;
}
