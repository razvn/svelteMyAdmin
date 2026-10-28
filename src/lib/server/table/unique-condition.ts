/**
 * Port of phpMyAdmin's Util::getUniqueCondition() (+ getConditionValue()).
 *
 * Builds the WHERE fragment that identifies one result row: primary key columns, else the columns
 * of a unique key, else every column ("not unique", callers must add LIMIT 1). Values are
 * quoted the way PHP does it: NULL as `IS NULL`, numbers verbatim, binary as `CAST(0x.. AS BINARY)`,
 * bit as `b'..'`, floats through `CONCAT()` (imprecise comparison), everything else as an
 * escaped string literal.
 */
import { bitLength, columnKind, type ColumnKind } from '#lib/table/column-kind.ts';
import type { ColumnInfo, IndexInfo } from '#lib/server/db/dbi.ts';
import { escapeId, escapeString } from '#lib/server/db/escape.ts';

export interface ConditionColumn {
	name: string;
	kind: ColumnKind;
	/** Part of the primary key / of the unique key chosen to identify rows. */
	key: 'primary' | 'unique' | null;
	/** `bit(N)` width. */
	bitLength?: number;
}

export interface UniqueCondition {
	/** The WHERE fragment (without `WHERE`); empty when `forceUnique` found no key. */
	clause: string;
	/** True when built from a primary/unique key. */
	isUnique: boolean;
	/** Qualified column expression => value condition, like PHP's `$conditionArray`. */
	parts: Record<string, string>;
}

export type RowValue = string | number | bigint | boolean | Uint8Array | null | undefined;

/** PHP: binary values are hexified only below this length. */
const MAX_BINARY_LENGTH = 1000;
const MAX_GEOMETRY_LENGTH = 5000;

/** Util::printableBitValue(): `value` as a zero padded binary string of `length` digits. */
export function printableBitValue(value: bigint | number, length: number): string {
	return BigInt(value).toString(2).padStart(length, '0');
}

function bufferToBigInt(b: Uint8Array): bigint {
	let n = 0n;
	for (const byte of b) n = (n << 8n) | BigInt(byte);
	return n;
}

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * The condition of one column, or null when it cannot take part (too large binary).
 * `single` = the result has one column only (PHP falls back to a length comparison).
 */
function conditionValue(
	value: RowValue,
	col: ConditionColumn,
	key: string,
	single: boolean
): { head: string; value: string } | null {
	if (value === null || value === undefined) return { head: key, value: 'IS NULL' };

	switch (col.kind) {
		case 'integer':
		case 'decimal':
		case 'real': {
			const text = String(value);
			// Server values are numeric; a stray string must never reach the SQL unquoted.
			return { head: key, value: NUMERIC.test(text) ? `= ${text}` : `= '${escapeString(text)}'` };
		}
		case 'binary': {
			const bytes = value instanceof Uint8Array ? value : Buffer.from(String(value));
			if (bytes.length === 0) return { head: key, value: "= ''" };
			if (bytes.length < MAX_BINARY_LENGTH) {
				// CAST avoids problems with the wildcard characters % and _.
				return { head: key, value: `= CAST(0x${toHex(bytes)} AS BINARY)` };
			}
			if (single) return { head: `CHAR_LENGTH(${key})`, value: `= ${bytes.length}` };
			return null;
		}
		case 'geometry': {
			// Geometry is browsed as WKT text; only raw bytes can be matched exactly.
			if (value instanceof Uint8Array && value.length > 0 && value.length < MAX_GEOMETRY_LENGTH) {
				return { head: key, value: `= CAST(0x${toHex(value)} AS BINARY)` };
			}
			return null;
		}
		case 'bit': {
			const n =
				value instanceof Uint8Array
					? bufferToBigInt(value)
					: BigInt(typeof value === 'boolean' ? Number(value) : value);
			return { head: key, value: `= b'${printableBitValue(n, col.bitLength ?? 1)}'` };
		}
		default: {
			const text =
				value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : String(value);
			return { head: key, value: `= '${escapeString(text)}'` };
		}
	}
}

/**
 * @param table  table the columns belong to (the qualifier of every column in the clause)
 * @param columns column descriptions aligned with `row`
 * @param row    values in the same order as `columns`
 * @param forceUnique only accept a primary/unique key (PHP `$forceUnique`)
 */
export function uniqueCondition(
	table: string,
	columns: ConditionColumn[],
	row: readonly RowValue[],
	forceUnique = false
): UniqueCondition {
	const primary: string[] = [];
	const unique: string[] = [];
	const all: string[] = [];
	const primaryParts: Record<string, string> = {};
	const uniqueParts: Record<string, string> = {};
	const allParts: Record<string, string> = {};

	columns.forEach((col, i) => {
		// Floats cannot be compared reliably: CONCAT() compares their text form (and `CONCAT(x) IS NULL` works).
		const key =
			col.kind === 'real'
				? `CONCAT(${escapeId(table)}.${escapeId(col.name)})`
				: `${escapeId(table)}.${escapeId(col.name)}`;
		const cv = conditionValue(row[i], col, key, columns.length === 1);
		if (!cv) return;
		const text = `${cv.head} ${cv.value}`;
		if (col.key === 'primary') {
			primary.push(text);
			primaryParts[key] = cv.value;
		} else if (col.key === 'unique') {
			unique.push(text);
			uniqueParts[key] = cv.value;
		}
		all.push(text);
		allParts[key] = cv.value;
	});

	if (primary.length) return { clause: primary.join(' AND '), isUnique: true, parts: primaryParts };
	if (unique.length) return { clause: unique.join(' AND '), isUnique: true, parts: uniqueParts };
	if (!forceUnique) return { clause: all.join(' AND '), isUnique: false, parts: allParts };
	return { clause: '', isUnique: false, parts: {} };
}

/**
 * Mark the key columns of a table: the primary key, else the first unique index whose columns are
 * all NOT NULL (NULLs never collide in a unique index, so it would not identify a row) and not
 * prefix-limited. Unlike PHP's per-column flags this keeps composite unique keys whole.
 */
export function conditionColumns(columns: ColumnInfo[], indexes: IndexInfo[]): ConditionColumn[] {
	const nullable = new Map(columns.map((c) => [c.field, c.null]));
	const groups = new Map<string, IndexInfo[]>();
	for (const idx of indexes) {
		if (idx.nonUnique) continue;
		const g = groups.get(idx.keyName) ?? [];
		g.push(idx);
		groups.set(idx.keyName, g);
	}
	const ordered = [...groups.entries()].map(([name, g]) => ({
		name,
		cols: g.sort((a, b) => a.seqInIndex - b.seqInIndex)
	}));

	const primary =
		ordered.find((g) => g.name === 'PRIMARY')?.cols.map((i) => i.columnName ?? '') ?? [];
	let unique: string[] = [];
	if (!primary.length) {
		const usable = ordered.find((g) =>
			g.cols.every(
				(i) => i.columnName !== null && i.subPart === null && nullable.get(i.columnName) === false
			)
		);
		unique = usable?.cols.map((i) => i.columnName ?? '') ?? [];
	}
	return columns.map((c) => ({
		name: c.field,
		kind: columnKind(c.type),
		key: primary.includes(c.field) ? 'primary' : unique.includes(c.field) ? 'unique' : null,
		bitLength: c.type.toLowerCase().startsWith('bit') ? bitLength(c.type) : undefined
	}));
}
