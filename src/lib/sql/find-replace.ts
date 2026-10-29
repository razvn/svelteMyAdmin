/**
 * SQL for Table > Find and replace (port of Controllers/Table/FindReplaceController.php).
 *
 * phpMyAdmin does plain REPLACE() for text and replaces regular expressions with PHP's
 * preg_replace; here the database does both: REPLACE() or REGEXP_REPLACE() (MySQL 8.0.4+ /
 * MariaDB 10.0.5+). Matching is case sensitive in both modes, like the `_bin` collation trick of
 * the original. Values are always bound as `?` parameters.
 */
import { escapeId, escapeQualified } from '#lib/server/db/escape.ts';
import { baseColumnType } from './table-operators.ts';
import { N_ } from '#lib/i18n/translator.ts';

export interface FindReplaceRequest {
	db: string;
	table: string;
	column: string;
	find: string;
	replaceWith: string;
	useRegex: boolean;
}

export interface ServerFlavor {
	isMariaDB: boolean;
	/** Numeric version, 80404 for 8.4.4. */
	versionInt: number;
	/** `@@character_set_connection`, used for the `_bin` collation of LIKE. */
	charset: string;
}

export interface BuiltSql {
	sql: string;
	params: string[];
}

export interface FindReplaceSql {
	/** Number of rows that contain a match. */
	count: BuiltSql;
	/** Distinct original values with their replacement and how many rows hold them. */
	preview: BuiltSql;
	update: BuiltSql;
}

/** Text columns that can be searched: CHAR/VARCHAR/*TEXT (no binary, blob, enum or set). */
export function isReplaceableType(type: string): boolean {
	return /^(char|varchar|tinytext|text|mediumtext|longtext)$/i.test(baseColumnType(type));
}

/** Backslash-escape LIKE wildcards of a bound value. */
export function likePattern(value: string): string {
	return '%' + value.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

export function supportsRegexReplace(
	flavor: Pick<ServerFlavor, 'isMariaDB' | 'versionInt'>
): boolean {
	return flavor.isMariaDB ? flavor.versionInt >= 100005 : flavor.versionInt >= 80004;
}

export function buildFindReplaceSql(req: FindReplaceRequest, flavor: ServerFlavor): FindReplaceSql {
	if (req.find === '') throw new Error(N_('Nothing to find'));
	if (!/^[A-Za-z0-9_]+$/.test(flavor.charset)) throw new Error('Unexpected connection charset');
	const table = escapeQualified(req.db, req.table);
	const col = escapeId(req.column);

	let expr: string;
	let exprParams: string[];
	let where: string;
	let whereParams: string[];
	if (req.useRegex) {
		if (!supportsRegexReplace(flavor)) {
			throw new Error(N_('Regular expression replacement needs MySQL 8.0.4+ or MariaDB 10.0.5+'));
		}
		if (flavor.isMariaDB) {
			// PCRE: case-insensitive by collation unless switched off.
			const pattern = '(?-i)' + req.find;
			expr = `REGEXP_REPLACE(${col}, ?, ?)`;
			exprParams = [pattern, req.replaceWith];
			where = `${col} REGEXP ?`;
			whereParams = [pattern];
		} else {
			expr = `REGEXP_REPLACE(${col}, ?, ?, 1, 0, 'c')`;
			exprParams = [req.find, req.replaceWith];
			where = `REGEXP_LIKE(${col}, ?, 'c')`;
			whereParams = [req.find];
		}
	} else {
		expr = `REPLACE(${col}, ?, ?)`;
		exprParams = [req.find, req.replaceWith];
		// Binary collation on the pattern makes LIKE case sensitive, as REPLACE() is.
		where = `${col} LIKE ? COLLATE ${flavor.charset}_bin`;
		whereParams = [likePattern(req.find)];
	}

	return {
		count: { sql: `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params: whereParams },
		preview: {
			sql:
				`SELECT ${col} AS original, ${expr} AS replaced, COUNT(*) AS n FROM ${table} ` +
				`WHERE ${where} GROUP BY ${col} ORDER BY ${col} ASC LIMIT 100`,
			params: [...exprParams, ...whereParams]
		},
		update: {
			sql: `UPDATE ${table} SET ${col} = ${expr} WHERE ${where}`,
			params: [...exprParams, ...whereParams]
		}
	};
}
