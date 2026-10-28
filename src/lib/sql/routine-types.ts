/**
 * Constants and tiny pure helpers shared by the routine editor UI and the SQL builders.
 * No imports: this file is safe to bundle into the browser.
 * Mirrors Database/Routines.php (`$directions`, `$sqlDataAccess`) and Util::getSupportedDatatypes().
 */

export const ROUTINE_TYPES = ['PROCEDURE', 'FUNCTION'] as const;
export type RoutineType = (typeof ROUTINE_TYPES)[number];

export const PARAM_DIRECTIONS = ['IN', 'OUT', 'INOUT'] as const;
export type ParamDirection = (typeof PARAM_DIRECTIONS)[number];

export const SQL_DATA_ACCESS = [
	'CONTAINS SQL',
	'NO SQL',
	'READS SQL DATA',
	'MODIFIES SQL DATA'
] as const;
export type SqlDataAccess = (typeof SQL_DATA_ACCESS)[number];

export const SECURITY_TYPES = ['DEFINER', 'INVOKER'] as const;
export type SecurityType = (typeof SECURITY_TYPES)[number];

/** Data types accepted for parameters and return values. */
export const ROUTINE_DATA_TYPES = [
	'INT',
	'TINYINT',
	'SMALLINT',
	'MEDIUMINT',
	'BIGINT',
	'DECIMAL',
	'FLOAT',
	'DOUBLE',
	'REAL',
	'BIT',
	'BOOLEAN',
	'SERIAL',
	'DATE',
	'DATETIME',
	'TIMESTAMP',
	'TIME',
	'YEAR',
	'CHAR',
	'VARCHAR',
	'TINYTEXT',
	'TEXT',
	'MEDIUMTEXT',
	'LONGTEXT',
	'BINARY',
	'VARBINARY',
	'TINYBLOB',
	'BLOB',
	'MEDIUMBLOB',
	'LONGBLOB',
	'ENUM',
	'SET',
	'JSON'
] as const;

export const NUMERIC_OPTIONS = ['UNSIGNED', 'ZEROFILL', 'UNSIGNED ZEROFILL'] as const;

const NUMBER_TYPES = new Set([
	'INT',
	'TINYINT',
	'SMALLINT',
	'MEDIUMINT',
	'BIGINT',
	'DECIMAL',
	'FLOAT',
	'DOUBLE',
	'REAL'
]);
/** Character types that take a CHARSET option (binary types do not). */
const CHARSET_TYPES = new Set([
	'CHAR',
	'VARCHAR',
	'TINYTEXT',
	'TEXT',
	'MEDIUMTEXT',
	'LONGTEXT',
	'ENUM',
	'SET'
]);
/** Types for which a "(length)" suffix is never written. */
const NO_LENGTH_TYPES = new Set([
	'DATE',
	'TINYBLOB',
	'TINYTEXT',
	'BLOB',
	'TEXT',
	'MEDIUMBLOB',
	'MEDIUMTEXT',
	'LONGBLOB',
	'LONGTEXT',
	'SERIAL',
	'BOOLEAN',
	'JSON',
	'YEAR'
]);
/** Types for which a length/values list is mandatory. */
const LENGTH_REQUIRED_TYPES = new Set(['ENUM', 'SET', 'VARCHAR', 'VARBINARY']);

export const isNumericType = (type: string): boolean => NUMBER_TYPES.has(type.toUpperCase());
export const isCharsetType = (type: string): boolean => CHARSET_TYPES.has(type.toUpperCase());
export const acceptsLength = (type: string): boolean => !NO_LENGTH_TYPES.has(type.toUpperCase());
export const requiresLength = (type: string): boolean =>
	LENGTH_REQUIRED_TYPES.has(type.toUpperCase());

/** Which kind of "options" input a type has in the editor. */
export function optionsKind(type: string): 'numeric' | 'charset' | 'none' {
	if (isNumericType(type)) return 'numeric';
	if (isCharsetType(type)) return 'charset';
	return 'none';
}
