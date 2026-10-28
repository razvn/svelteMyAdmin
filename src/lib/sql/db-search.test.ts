import { describe, expect, it } from 'vitest';
import {
	buildWhereClause,
	searchSqls,
	searchWords,
	SEARCH_TYPES,
	type SearchCriteria,
	type SearchType
} from './db-search.ts';

const COLUMNS = ['id', 'name'];
const crit = (searchString: string, searchType: SearchType, columnName = ''): SearchCriteria => ({
	searchString,
	searchType,
	columnName
});

describe('searchWords', () => {
	it('splits on single spaces for types 1 and 2 and drops empty pieces', () => {
		expect(searchWords(crit('  a  b ', 1))).toEqual(['a', 'b']);
		expect(searchWords(crit('a b', 2))).toEqual(['a', 'b']);
	});

	it('keeps the whole string as one value for types 3, 4 and 5', () => {
		for (const t of [3, 4, 5] as const) {
			expect(searchWords(crit('Le Guin', t))).toEqual(['Le Guin']);
		}
	});

	it('returns no words for an empty string', () => {
		expect(searchWords(crit('', 1))).toEqual([]);
		expect(searchWords(crit('', 3))).toEqual([]);
	});
});

describe('buildWhereClause: one case per search type', () => {
	it('type 1 (at least one of the words): LIKE %word% per column, words OR-ed', () => {
		expect(buildWhereClause(COLUMNS, crit('Ursula Guin', 1))).toEqual({
			where:
				' WHERE (CONVERT(`id` USING utf8mb4) LIKE ? OR CONVERT(`name` USING utf8mb4) LIKE ?)' +
				' OR (CONVERT(`id` USING utf8mb4) LIKE ? OR CONVERT(`name` USING utf8mb4) LIKE ?)',
			params: ['%Ursula%', '%Ursula%', '%Guin%', '%Guin%']
		});
	});

	it('type 2 (all of the words): same clauses combined with AND', () => {
		expect(buildWhereClause(COLUMNS, crit('Ursula Guin', 2))).toEqual({
			where:
				' WHERE (CONVERT(`id` USING utf8mb4) LIKE ? OR CONVERT(`name` USING utf8mb4) LIKE ?)' +
				' AND (CONVERT(`id` USING utf8mb4) LIKE ? OR CONVERT(`name` USING utf8mb4) LIKE ?)',
			params: ['%Ursula%', '%Ursula%', '%Guin%', '%Guin%']
		});
	});

	it('type 3 (exact phrase as substring): whole string wrapped in %', () => {
		expect(buildWhereClause(COLUMNS, crit('Le Guin', 3))).toEqual({
			where: ' WHERE (CONVERT(`id` USING utf8mb4) LIKE ? OR CONVERT(`name` USING utf8mb4) LIKE ?)',
			params: ['%Le Guin%', '%Le Guin%']
		});
	});

	it('type 4 (exact phrase as whole field): LIKE without wildcards', () => {
		expect(buildWhereClause(COLUMNS, crit('Solaris', 4))).toEqual({
			where: ' WHERE (CONVERT(`id` USING utf8mb4) LIKE ? OR CONVERT(`name` USING utf8mb4) LIKE ?)',
			params: ['Solaris', 'Solaris']
		});
	});

	it('type 5 (regular expression): REGEXP without wildcards', () => {
		expect(buildWhereClause(COLUMNS, crit('^Stan', 5))).toEqual({
			where:
				' WHERE (CONVERT(`id` USING utf8mb4) REGEXP ? OR CONVERT(`name` USING utf8mb4) REGEXP ?)',
			params: ['^Stan', '^Stan']
		});
	});

	it('covers all five types in SEARCH_TYPES', () => {
		expect(SEARCH_TYPES.map((t) => t.value)).toEqual([1, 2, 3, 4, 5]);
		expect(SEARCH_TYPES.map((t) => t.label)).toEqual([
			'at least one of the words',
			'all of the words',
			'the exact phrase as substring',
			'the exact phrase as whole field',
			'as regular expression'
		]);
	});
});

describe('buildWhereClause: column restriction and no matches', () => {
	it('restricts to the named column only', () => {
		expect(buildWhereClause(COLUMNS, crit('Guin', 3, 'name'))).toEqual({
			where: ' WHERE (CONVERT(`name` USING utf8mb4) LIKE ?)',
			params: ['%Guin%']
		});
	});

	it('is WHERE FALSE when the named column is not in the table', () => {
		expect(buildWhereClause(COLUMNS, crit('Guin', 3, 'missing'))).toEqual({
			where: ' WHERE FALSE',
			params: []
		});
	});

	it('is WHERE FALSE when there are no words to search', () => {
		expect(buildWhereClause(COLUMNS, crit('', 1))).toEqual({
			where: ' WHERE FALSE',
			params: []
		});
	});

	it('is WHERE FALSE when the table has no columns', () => {
		expect(buildWhereClause([], crit('x', 3))).toEqual({ where: ' WHERE FALSE', params: [] });
	});
});

describe('buildWhereClause: wildcards', () => {
	it('keeps % and _ as LIKE wildcards, as phpMyAdmin does (no LIKE escaping)', () => {
		expect(buildWhereClause(['name'], crit('a_b%', 3)).params).toEqual(['%a_b%%']);
		expect(buildWhereClause(['name'], crit('a_b%', 4)).params).toEqual(['a_b%']);
	});
});

describe('buildWhereClause: literals mode (Delete confirmation)', () => {
	it('inlines values with mysql string escaping, like PHP escapeString()', () => {
		expect(buildWhereClause(['name'], crit("O'Brien", 3), 'literals')).toEqual({
			where: " WHERE (CONVERT(`name` USING utf8mb4) LIKE '%O\\'Brien%')",
			params: []
		});
	});

	it('escapes backslashes and double quotes', () => {
		expect(buildWhereClause(['name'], crit('a\\b "c"', 4), 'literals').where).toBe(
			' WHERE (CONVERT(`name` USING utf8mb4) LIKE \'a\\\\b \\"c\\"\')'
		);
	});

	it('leaves wildcards untouched', () => {
		expect(buildWhereClause(['name'], crit('a_b%', 3), 'literals').where).toBe(
			" WHERE (CONVERT(`name` USING utf8mb4) LIKE '%a_b%%')"
		);
	});
});

describe('searchSqls', () => {
	it('builds the count and delete statements around the same WHERE', () => {
		const sqls = searchSqls('sma_test', 'authors', COLUMNS, crit('Guin', 3));
		const where =
			' WHERE (CONVERT(`id` USING utf8mb4) LIKE ? OR CONVERT(`name` USING utf8mb4) LIKE ?)';
		expect(sqls).toEqual({
			where,
			params: ['%Guin%', '%Guin%'],
			count: 'SELECT COUNT(*) AS `count` FROM `sma_test`.`authors`' + where,
			delete: 'DELETE FROM `sma_test`.`authors`' + where
		});
	});

	it('escapes database, table and column identifiers with backticks', () => {
		const sqls = searchSqls('my`db', 'a`b', ['c`d'], crit('x', 4), 'literals');
		expect(sqls.count).toBe(
			"SELECT COUNT(*) AS `count` FROM `my``db`.`a``b` WHERE (CONVERT(`c``d` USING utf8mb4) LIKE 'x')"
		);
		expect(sqls.delete).toBe(
			"DELETE FROM `my``db`.`a``b` WHERE (CONVERT(`c``d` USING utf8mb4) LIKE 'x')"
		);
	});

	it('uses WHERE FALSE for the delete when nothing can match', () => {
		expect(searchSqls('d', 't', ['id'], crit('x', 3, 'nope')).delete).toBe(
			'DELETE FROM `d`.`t` WHERE FALSE'
		);
	});
});
