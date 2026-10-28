/**
 * Search operators per column type. Port of the operator part of libraries/classes/Types.php
 * (getTypeOperators / getNumberOperators / getTextOperators / getEnumOperators /
 * getUUIDOperators / getNullOperators / getUnaryOperators) and of the geometry function list of
 * libraries/classes/Utils/Gis.php. Pure and free of server imports, so the search page can use it.
 */

export const UNARY_OPERATORS = ['IS NULL', 'IS NOT NULL', "= ''", "!= ''"] as const;
export const NULL_OPERATORS = ['IS NULL', 'IS NOT NULL'] as const;
export const ENUM_OPERATORS = ['=', '!='] as const;
export const TEXT_OPERATORS = [
	'LIKE',
	'LIKE %...%',
	'NOT LIKE',
	'NOT LIKE %...%',
	'=',
	'!=',
	'REGEXP',
	'REGEXP ^...$',
	'NOT REGEXP',
	"= ''",
	"!= ''",
	'IN (...)',
	'NOT IN (...)',
	'BETWEEN',
	'NOT BETWEEN'
] as const;
export const NUMBER_OPERATORS = [
	'=',
	'>',
	'>=',
	'<',
	'<=',
	'!=',
	'LIKE',
	'LIKE %...%',
	'NOT LIKE',
	'NOT LIKE %...%',
	'IN (...)',
	'NOT IN (...)',
	'BETWEEN',
	'NOT BETWEEN'
] as const;
export const UUID_OPERATORS = [
	'=',
	'!=',
	'LIKE',
	'LIKE %...%',
	'NOT LIKE',
	'NOT LIKE %...%',
	'IN (...)',
	'NOT IN (...)'
] as const;

export const isUnaryOperator = (op: string): boolean =>
	(UNARY_OPERATORS as readonly string[]).includes(op);

export const isRangeOperator = (op: string): boolean => op === 'BETWEEN' || op === 'NOT BETWEEN';

export const isListOperator = (op: string): boolean => op === 'IN (...)' || op === 'NOT IN (...)';

export type TypeClass = 'NUMBER' | 'DATE' | 'CHAR' | 'SPATIAL' | 'JSON' | 'UUID' | '';

const NUMBER_TYPES = [
	'TINYINT',
	'SMALLINT',
	'MEDIUMINT',
	'INT',
	'BIGINT',
	'DECIMAL',
	'FLOAT',
	'DOUBLE',
	'REAL',
	'BIT',
	'BOOLEAN',
	'SERIAL'
];
const DATE_TYPES = ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR'];
const CHAR_TYPES = [
	'CHAR',
	'VARCHAR',
	'TINYTEXT',
	'TEXT',
	'MEDIUMTEXT',
	'LONGTEXT',
	'BINARY',
	'VARBINARY',
	'TINYBLOB',
	'MEDIUMBLOB',
	'BLOB',
	'LONGBLOB',
	'ENUM',
	'SET',
	'INET6'
];
export const GEOMETRY_TYPES = [
	'GEOMETRY',
	'POINT',
	'LINESTRING',
	'POLYGON',
	'MULTIPOINT',
	'MULTILINESTRING',
	'MULTIPOLYGON',
	'GEOMETRYCOLLECTION'
];

/** Types.php getTypeClass(): class of a bare type name (no length, no attributes). */
export function getTypeClass(type: string): TypeClass {
	const t = type.toUpperCase();
	if (NUMBER_TYPES.includes(t)) return 'NUMBER';
	if (DATE_TYPES.includes(t)) return 'DATE';
	if (CHAR_TYPES.includes(t)) return 'CHAR';
	if (GEOMETRY_TYPES.includes(t)) return 'SPATIAL';
	if (t === 'JSON') return 'JSON';
	if (t === 'UUID') return 'UUID';
	return '';
}

/**
 * Column type as the search pages see it (`SHOW COLUMNS` Type, normalised like
 * SearchController::loadTableInfo): lowercase, without UNSIGNED/ZEROFILL and the BINARY attribute
 * (kept in BINARY(n)/VARBINARY(n)); ENUM/SET lists keep their case and get a space after commas.
 */
export function normalizeColumnType(raw: string): string {
	let type = raw;
	if (/^(set|enum)/i.test(type)) return type.replaceAll(',', ', ');
	if (!/BINARY\(/i.test(type)) type = type.replace(/binary/gi, '');
	type = type.replace(/zerofill/gi, '').replace(/unsigned/gi, '');
	return type.trim().toLowerCase();
}

/** `varchar(255)` -> `varchar`. */
export function baseColumnType(type: string): string {
	return type.replace(/\(.*/s, '').trim();
}

/** Operators offered for a column of this (normalised or bare) type; NULL ones when nullable. */
export function getTypeOperators(type: string, nullable: boolean): string[] {
	const base = baseColumnType(type);
	const cls = getTypeClass(base);
	let ops: readonly string[];
	if (/^enum/i.test(type)) ops = ENUM_OPERATORS;
	else if (cls === 'CHAR') ops = TEXT_OPERATORS;
	else if (cls === 'UUID') ops = UUID_OPERATORS;
	else ops = NUMBER_OPERATORS;
	return nullable ? [...ops, ...NULL_OPERATORS] : [...ops];
}

/** Values of `enum('a','b')` / `set(...)`; `''` inside a value is an escaped quote. */
export function parseEnumSetValues(type: string): string[] {
	const open = type.indexOf('(');
	const close = type.lastIndexOf(')');
	if (open < 0 || close < open) return [];
	const body = type.slice(open + 1, close);
	const values: string[] = [];
	const re = /'((?:[^'\\]|''|\\.)*)'/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body))) {
		values.push(m[1].replaceAll("''", "'").replace(/\\(.)/g, '$1'));
	}
	return values;
}

export interface GeometryFunction {
	name: string;
	/** Number of geometry arguments (2 = takes a second geometry typed by the user). */
	params: 1 | 2;
	/** Result type, lowercase (`int`, `float`, `text`, `point`, `polygon`, `linestring`). */
	type: string;
}

const uni = (name: string, type: string): GeometryFunction => ({ name, params: 1, type });
const bin = (name: string): GeometryFunction => ({ name, params: 2, type: 'int' });

/**
 * Gis::getFunctions($type, true, false) with the ST_ prefix. Functions removed from MySQL 8
 * (Dimension, Envelope, GLength, ...) are listed by their ST_ names, which both MySQL and MariaDB
 * accept; ST_IsRing only exists on MariaDB.
 */
export function getGeometryFunctions(type: string, isMariaDB = false): GeometryFunction[] {
	const t = baseColumnType(type).toLowerCase();
	const funcs: GeometryFunction[] = [
		uni('ST_Dimension', 'int'),
		uni('ST_Envelope', 'polygon'),
		uni('ST_GeometryType', 'text'),
		uni('ST_SRID', 'int'),
		uni('ST_IsEmpty', 'int'),
		uni('ST_IsSimple', 'int')
	];
	if (t === 'point') {
		funcs.push(uni('ST_X', 'float'), uni('ST_Y', 'float'));
	} else if (t === 'linestring') {
		funcs.push(
			uni('ST_EndPoint', 'point'),
			uni('ST_Length', 'float'),
			uni('ST_NumPoints', 'int'),
			uni('ST_StartPoint', 'point')
		);
		if (isMariaDB) funcs.push(uni('ST_IsRing', 'int'));
	} else if (t === 'multilinestring') {
		funcs.push(uni('ST_Length', 'float'), uni('ST_IsClosed', 'int'));
	} else if (t === 'polygon') {
		funcs.push(
			uni('ST_Area', 'float'),
			uni('ST_ExteriorRing', 'linestring'),
			uni('ST_NumInteriorRings', 'int')
		);
	} else if (t === 'multipolygon') {
		funcs.push(uni('ST_Area', 'float'), uni('ST_Centroid', 'point'));
	} else if (t === 'geometrycollection') {
		funcs.push(uni('ST_NumGeometries', 'int'));
	}
	funcs.push(
		bin('ST_Crosses'),
		bin('ST_Contains'),
		bin('ST_Disjoint'),
		bin('ST_Equals'),
		bin('ST_Intersects'),
		bin('ST_Overlaps'),
		bin('ST_Touches'),
		bin('ST_Within'),
		bin('MBRContains'),
		bin('MBRDisjoint'),
		bin('MBREquals'),
		bin('MBRIntersects'),
		bin('MBROverlaps'),
		bin('MBRTouches'),
		bin('MBRWithin')
	);
	return funcs;
}
