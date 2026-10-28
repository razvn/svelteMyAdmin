/**
 * WHERE clause builder for Table > Search and Zoom search. Port of
 * libraries/classes/Table/Search.php (generateWhereClause / getWhereClause / getGeomWhereClause /
 * getEnumWhereClause). Pure: values are escaped inline with `escapeString`.
 *
 * Deliberate hardening versus phpMyAdmin: a value that would be left unquoted (numeric columns)
 * is only emitted bare when it really is a number, otherwise it is quoted; geometry text is always
 * escaped and never spliced in as raw SQL.
 */
import { escapeId, escapeString } from '#lib/server/db/escape.ts';
import {
	baseColumnType,
	getGeometryFunctions,
	isListOperator,
	isRangeOperator,
	isUnaryOperator,
	GEOMETRY_TYPES
} from './table-operators.ts';

export * from './table-operators.ts';

export interface Criterion {
	column: string;
	/** Column type as returned by `normalizeColumnType()`. */
	type: string;
	operator: string;
	/** A string, or several values (multi-select ENUM, BETWEEN bounds). */
	value: string | string[];
	/** Geometry function chosen for spatial columns (`ST_Contains`, ...); empty for none. */
	geomFunc?: string;
}

export interface BuildOptions {
	isMariaDB?: boolean;
}

const QUOTED_TYPES = /char|binary|blob|text|set|date|time|year|uuid/i;
const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const GEOM_TYPE_RE =
	'(POINT|MULTIPOINT|LINESTRING|MULTILINESTRING|POLYGON|MULTIPOLYGON|GEOMETRYCOLLECTION)';

const q = (value: string): string => "'" + escapeString(value) + "'";

const isEmptyValue = (value: string | string[]): boolean =>
	Array.isArray(value) ? value.length === 0 || value.every((v) => v === '') : value === '';

/** Utils/Gis::createData(): WKT text to ST_GeomFromText(...), anything else to a string literal. */
export function geometryValue(text: string): string {
	const s = text.trim();
	const withSrid = s.match(new RegExp(`^'(${GEOM_TYPE_RE}\\(.*\\))',(\\d*)$`, 'is'));
	if (withSrid) {
		const srid = withSrid[3];
		return `ST_GeomFromText(${q(withSrid[1])}${srid ? ', ' + srid : ''})`;
	}
	if (new RegExp(`^${GEOM_TYPE_RE}\\(.*\\)$`, 'is').test(s)) return `ST_GeomFromText(${q(s)})`;
	return q(s);
}

function geomClause(c: Criterion, opts: BuildOptions): string {
	const col = escapeId(c.column);
	const value = Array.isArray(c.value) ? (c.value[0] ?? '') : c.value;
	if (c.operator.includes('IS NULL') || c.operator.includes('IS NOT NULL')) {
		return `${col} ${c.operator}`;
	}
	const fn = getGeometryFunctions(c.type, opts.isMariaDB).find((f) => f.name === c.geomFunc);
	if (!fn) return '';
	if (fn.params > 1) {
		return value.trim() === '' ? '' : `${fn.name}(${col}, ${geometryValue(value)})`;
	}
	const applied = `${fn.name}(${col})`;
	const op = isUnaryOperator(c.operator) ? '=' : c.operator;
	if (/^ST_Is(Empty|Simple|Ring|Closed)$/.test(fn.name) && value.trim() === '') return applied;
	if (value === '') return '';
	if (GEOMETRY_TYPES.includes(fn.type.toUpperCase()))
		return `${applied} ${op} ${geometryValue(value)}`;
	return `${applied} ${op} ${q(value)}`;
}

function enumClause(col: string, value: string | string[], operator: string): string {
	const values = Array.isArray(value) ? value : value.split(',');
	let op = operator;
	let open = '';
	let close = '';
	if (values.length > 1 && op === '=') [op, open, close] = ['IN', '(', ')'];
	else if (values.length > 1 && op === '!=') [op, open, close] = ['NOT IN', '(', ')'];
	return `${col} ${op} ${open}${values.map(q).join(', ')}${close}`;
}

/** One criterion to a SQL condition; '' when it has nothing to filter on (skipped, like PHP). */
export function buildCriterionClause(c: Criterion, opts: BuildOptions = {}): string {
	if (c.geomFunc) return geomClause(c, opts);

	const col = escapeId(c.column);
	if (isUnaryOperator(c.operator)) return `${col} ${c.operator}`;

	const isEnum = /^enum/i.test(c.type);
	const enumValue = Array.isArray(c.value) ? c.value.filter((v) => v !== '') : c.value;
	if (isEnum && !isEmptyValue(enumValue) && enumValue !== '0') {
		return enumClause(col, enumValue, c.operator);
	}

	if (isEmptyValue(c.value)) return '';
	const raw = Array.isArray(c.value) ? c.value.join(',') : c.value;
	// Quote even numeric columns for LIKE: MySQL converts as needed.
	const quoteAll = QUOTED_TYPES.test(c.type) || c.operator.includes('LIKE');
	const lit = (v: string): string => (quoteAll || !NUMBER_RE.test(v) ? q(v) : v);

	let op = c.operator;
	let value = raw;
	if (op === 'LIKE %...%') [op, value] = ['LIKE', `%${raw}%`];
	else if (op === 'NOT LIKE %...%') [op, value] = ['NOT LIKE', `%${raw}%`];
	else if (op === 'REGEXP ^...$') [op, value] = ['REGEXP', `^${raw}$`];

	if (!isListOperator(op) && !isRangeOperator(op)) return `${col} ${op} ${lit(value)}`;

	const op2 = op.replace(' (...)', '');
	const parts = Array.isArray(c.value) ? c.value : raw.split(',');
	if (isRangeOperator(op2)) {
		const one = (v: string | undefined): string =>
			v === undefined || v === '' ? 'NULL' : lit(v.trim());
		return `${col} ${op2} ${one(parts[0])} AND ${one(parts[1])}`;
	}
	const values = parts.filter((v) => v !== '').map((v) => lit(v.trim()));
	const hasEmpty = parts.some((v) => v === '');
	const wheres: string[] = [];
	if (values.length > 0) wheres.push(`${col} ${op2} (${values.join(',')})`);
	if (hasEmpty) wheres.push(`${col} IS NULL`);
	const joined = wheres.join(' OR ');
	return wheres.length > 1 ? `(${joined})` : joined;
}

/**
 * Whole WHERE body (no `WHERE` keyword): the custom clause when given, otherwise the criteria
 * joined with AND. '' means "no filter".
 */
export function buildWhereBody(
	criteria: readonly Criterion[],
	customWhere = '',
	opts: BuildOptions = {}
): string {
	if (customWhere.trim() !== '') return customWhere.trim();
	return criteria
		.map((c) => buildCriterionClause(c, opts))
		.filter((s) => s !== '')
		.join(' AND ');
}

export { baseColumnType };
