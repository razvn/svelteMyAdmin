/**
 * Classification of MySQL/MariaDB column types for browsing (client-safe, pure).
 * Mirrors the FieldMetadata type groups phpMyAdmin uses in Results.php / Util::getUniqueCondition().
 */
export type ColumnKind =
	| 'integer'
	| 'decimal'
	| 'real'
	| 'bit'
	| 'binary'
	| 'geometry'
	| 'json'
	| 'temporal'
	| 'enum'
	| 'set'
	| 'text';

const GEOMETRY = new Set([
	'geometry',
	'point',
	'linestring',
	'polygon',
	'multipoint',
	'multilinestring',
	'multipolygon',
	'geometrycollection',
	'geomcollection'
]);

/** Kind of a column from its `SHOW COLUMNS` type (`int(11) unsigned`, `enum('a','b')`, ...). */
export function columnKind(type: string): ColumnKind {
	const base = type.trim().toLowerCase().split(/[\s(]/)[0];
	if (/^(tinyint|smallint|mediumint|int|integer|bigint|serial)$/.test(base)) return 'integer';
	if (base === 'decimal' || base === 'numeric' || base === 'dec' || base === 'fixed') {
		return 'decimal';
	}
	if (/^(float|double|real)$/.test(base)) return 'real';
	if (base === 'bit') return 'bit';
	if (/^(binary|varbinary|tinyblob|blob|mediumblob|longblob)$/.test(base)) return 'binary';
	if (GEOMETRY.has(base)) return 'geometry';
	if (base === 'json') return 'json';
	if (/^(date|time|datetime|timestamp|year)$/.test(base)) return 'temporal';
	if (base === 'enum') return 'enum';
	if (base === 'set') return 'set';
	return 'text';
}

export const isNumericKind = (kind: ColumnKind): boolean =>
	kind === 'integer' || kind === 'decimal' || kind === 'real';

/** Can a cell of this kind be edited as plain text in the grid? */
export const isInlineEditable = (kind: ColumnKind): boolean =>
	kind !== 'binary' && kind !== 'geometry' && kind !== 'bit';

/** Values of `enum('a','b')` / `set('x','y')` (MySQL quoting: `''` for a quote). */
export function parseEnumValues(type: string): string[] {
	const m = type.match(/^(?:enum|set)\s*\((.*)\)\s*$/is);
	if (!m) return [];
	const out: string[] = [];
	const re = /'((?:[^']|'')*)'/g;
	let r: RegExpExecArray | null;
	while ((r = re.exec(m[1])) !== null) out.push(r[1].replaceAll("''", "'"));
	return out;
}

/** Bit width of `bit(8)`; 1 when unspecified. */
export function bitLength(type: string): number {
	const m = type.match(/^bit\s*\((\d+)\)/i);
	return m ? Number(m[1]) : 1;
}
