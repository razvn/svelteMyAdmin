/**
 * Pure SQL builders for Database > Search. Port of libraries/classes/Database/Search.php
 * (getSearchSqls / getWhereClause). No database access happens here.
 *
 * Two output modes:
 * - `placeholders`: values become `?` and are returned in `params` (what the server executes).
 * - `literals`: values are inlined with the same escaping as PHP's `escapeString()` (what the
 *   Delete confirmation shows).
 *
 * phpMyAdmin does not escape `%` or `_` in the search string: they stay wildcards, which the
 * form documents ("wildcard: %"). The same holds here.
 */
import { escapeId, escapeQualified, escapeString } from '#lib/server/db/escape.ts';

export type SearchType = 1 | 2 | 3 | 4 | 5;

/** Search types, labels as in Search.php's `$searchTypes`. */
export const SEARCH_TYPES: readonly { value: SearchType; label: string }[] = [
	{ value: 1, label: 'at least one of the words' },
	{ value: 2, label: 'all of the words' },
	{ value: 3, label: 'the exact phrase as substring' },
	{ value: 4, label: 'the exact phrase as whole field' },
	{ value: 5, label: 'as regular expression' }
];

export interface SearchCriteria {
	/** Words or values; `%` is a wildcard. Empty means "no search". */
	searchString: string;
	searchType: SearchType;
	/** Restrict the search to this column name (exact match). Empty means every column. */
	columnName: string;
}

export type SqlMode = 'placeholders' | 'literals';

export interface SearchSqls {
	/** WHERE clause with its leading space; ` WHERE FALSE` when no selected column exists. */
	where: string;
	/** Values for the `?` placeholders, in order (always empty in literals mode). */
	params: string[];
	/** `SELECT COUNT(*) AS \`count\` FROM ... WHERE ...` */
	count: string;
	/** `DELETE FROM ... WHERE ...` */
	delete: string;
}

/**
 * Split the search string the way Search.php does: "at least one" / "all of the words" split on
 * single spaces (empty pieces dropped); the other types search the whole string as one value.
 */
export function searchWords(
	criteria: Pick<SearchCriteria, 'searchString' | 'searchType'>
): string[] {
	const { searchString, searchType } = criteria;
	if (searchType > 2) return searchString.length > 0 ? [searchString] : [];
	return searchString.split(' ').filter((word) => word.length > 0);
}

/**
 * WHERE clause for the given columns. Mirrors Search::getWhereClause(): one LIKE/REGEXP per
 * column and word, OR-ed within a word; words combined with OR (type 1) or AND (types 2-5).
 */
export function buildWhereClause(
	columns: readonly string[],
	criteria: SearchCriteria,
	mode: SqlMode = 'placeholders'
): { where: string; params: string[] } {
	const params: string[] = [];
	const bind = (value: string): string => {
		if (mode === 'literals') return "'" + escapeString(value) + "'";
		params.push(value);
		return '?';
	};

	const operator = criteria.searchType === 5 ? 'REGEXP' : 'LIKE';
	// Types 1-3 wrap the value in % (substring); 4 (whole field) and 5 (regexp) do not.
	const wildcard = criteria.searchType < 4 ? '%' : '';
	const targets =
		criteria.columnName !== '' ? columns.filter((c) => c === criteria.columnName) : columns;

	const wordClauses: string[] = [];
	for (const word of searchWords(criteria)) {
		const perColumn = targets.map(
			(column) =>
				`CONVERT(${escapeId(column)} USING utf8mb4) ${operator} ${bind(wildcard + word + wildcard)}`
		);
		if (perColumn.length > 0) wordClauses.push(perColumn.join(' OR '));
	}

	if (wordClauses.length === 0) return { where: ' WHERE FALSE', params };
	const combiner = criteria.searchType === 1 ? 'OR' : 'AND';
	return { where: ` WHERE (${wordClauses.join(`) ${combiner} (`)})`, params };
}

/** Count and delete statements for one table, with the WHERE of `buildWhereClause`. */
export function searchSqls(
	db: string,
	table: string,
	columns: readonly string[],
	criteria: SearchCriteria,
	mode: SqlMode = 'placeholders'
): SearchSqls {
	const { where, params } = buildWhereClause(columns, criteria, mode);
	const from = ` FROM ${escapeQualified(db, table)}`;
	return {
		where,
		params,
		count: `SELECT COUNT(*) AS ${escapeId('count')}${from}${where}`,
		delete: `DELETE${from}${where}`
	};
}
