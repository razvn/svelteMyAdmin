import { describe, expect, it } from 'vitest';
import { classifyStatement } from './classify.ts';
import { appendLimit, canPaginate } from './limit.ts';
import { analyzeSimpleSelect, applySort, isSortableField } from './result-sort.ts';
import {
	affectedRowsMessage,
	errorMessage,
	locateSyntaxError,
	showingRowsMessage,
	truncateSql
} from './messages.ts';

describe('classifyStatement', () => {
	it.each([
		['SELECT 1', 'select'],
		['  /* c */ select * from t', 'select'],
		['(SELECT 1) UNION (SELECT 2)', 'select'],
		['WITH x AS (SELECT 1) SELECT * FROM x', 'select'],
		['WITH x AS (SELECT 1) DELETE FROM t', 'dml'],
		['TABLE t', 'select'],
		['SHOW TABLES', 'show'],
		['EXPLAIN SELECT 1', 'explain'],
		['describe t', 'explain'],
		['INSERT INTO t VALUES (1)', 'dml'],
		['update t set a=1', 'dml'],
		['DELETE FROM t', 'dml'],
		['LOAD DATA INFILE "x" INTO TABLE t', 'dml'],
		['CREATE TABLE t (a int)', 'ddl'],
		['drop table t', 'ddl'],
		['CALL p()', 'other'],
		['SET @a = 1', 'other'],
		['', 'other'],
		['-- only a comment', 'other']
	])('%s => %s', (sql, kind) => {
		expect(classifyStatement(sql)).toBe(kind);
	});
});

describe('appendLimit', () => {
	it('appends to a plain select', () => {
		expect(appendLimit('SELECT * FROM t', 0, 25)).toEqual({
			sql: 'SELECT * FROM t LIMIT 0, 25',
			appended: true
		});
		expect(appendLimit('SELECT * FROM t WHERE 1', 50, 25).sql).toBe(
			'SELECT * FROM t WHERE 1 LIMIT 50, 25'
		);
	});
	it('leaves queries with a top-level LIMIT alone', () => {
		expect(appendLimit('SELECT * FROM t LIMIT 5', 0, 25).appended).toBe(false);
		expect(appendLimit('SELECT a FROM t UNION SELECT b FROM u LIMIT 5', 0, 25).appended).toBe(
			false
		);
	});
	it('ignores LIMIT inside subqueries and strings', () => {
		expect(appendLimit('SELECT * FROM (SELECT a FROM t LIMIT 5) x', 0, 25).appended).toBe(true);
		expect(appendLimit("SELECT 'limit' AS `limit`", 0, 25).appended).toBe(true);
	});
	it('skips INTO and non-selects', () => {
		expect(appendLimit('SELECT a INTO @x FROM t', 0, 25).appended).toBe(false);
		expect(appendLimit("SELECT * INTO OUTFILE '/tmp/x' FROM t", 0, 25).appended).toBe(false);
		expect(appendLimit('DELETE FROM t', 0, 25).appended).toBe(false);
		expect(appendLimit('SHOW TABLES', 0, 25).appended).toBe(false);
	});
	it('applies to the whole union', () => {
		expect(appendLimit('SELECT 1 UNION SELECT 2', 0, 10).sql).toBe(
			'SELECT 1 UNION SELECT 2 LIMIT 0, 10'
		);
		expect(appendLimit('(SELECT 1) UNION (SELECT 2)', 0, 10).sql).toBe(
			'(SELECT 1) UNION (SELECT 2) LIMIT 0, 10'
		);
	});
	it('inserts before locking clauses', () => {
		expect(appendLimit('SELECT * FROM t WHERE id = 1 FOR UPDATE', 0, 25).sql).toBe(
			'SELECT * FROM t WHERE id = 1 LIMIT 0, 25 FOR UPDATE'
		);
		expect(appendLimit('SELECT * FROM t LOCK IN SHARE MODE', 0, 25).sql).toBe(
			'SELECT * FROM t LIMIT 0, 25 LOCK IN SHARE MODE'
		);
	});
	it('is not swallowed by a trailing comment', () => {
		expect(appendLimit('SELECT 1 -- hi', 0, 5).sql).toBe('SELECT 1 LIMIT 0, 5 -- hi');
	});
	it('canPaginate', () => {
		expect(canPaginate('select 1')).toBe(true);
		expect(canPaginate('select 1 limit 1')).toBe(false);
	});
});

describe('analyzeSimpleSelect / applySort', () => {
	it('recognises single table selects', () => {
		expect(analyzeSimpleSelect('SELECT * FROM `books` WHERE 1')).toMatchObject({
			db: null,
			table: 'books',
			sort: null
		});
		expect(analyzeSimpleSelect('SELECT * FROM db1.t AS x ORDER BY x.a DESC LIMIT 5')).toMatchObject(
			{
				db: 'db1',
				table: 't',
				sort: { column: 'a', dir: 'desc' }
			}
		);
	});
	it.each([
		'SELECT * FROM a JOIN b ON a.id=b.id',
		'SELECT * FROM a, b',
		'SELECT * FROM (SELECT 1) x',
		'SELECT 1 UNION SELECT 2',
		'SELECT 1',
		'DELETE FROM t',
		'SELECT a INTO @x FROM t'
	])('rejects %s', (sql) => {
		expect(analyzeSimpleSelect(sql)).toBeNull();
	});
	it('multi-column order has no single sort state', () => {
		expect(analyzeSimpleSelect('SELECT * FROM t ORDER BY a, b')?.sort).toBeNull();
	});
	it('inserts, replaces and removes ORDER BY', () => {
		expect(applySort('SELECT * FROM t WHERE 1', { column: 'a', dir: 'asc' })).toBe(
			'SELECT * FROM t WHERE 1 ORDER BY `a` ASC'
		);
		expect(applySort('SELECT * FROM t LIMIT 5', { column: 'a', dir: 'desc' })).toBe(
			'SELECT * FROM t ORDER BY `a` DESC LIMIT 5'
		);
		expect(applySort('SELECT * FROM t ORDER BY b LIMIT 5', { column: 'a', dir: 'asc' })).toBe(
			'SELECT * FROM t ORDER BY `a` ASC LIMIT 5'
		);
		expect(applySort('SELECT * FROM t ORDER BY b DESC', null)).toBe('SELECT * FROM t');
		expect(applySort('SELECT * FROM t ORDER BY b FOR UPDATE', { column: 'c', dir: 'asc' })).toBe(
			'SELECT * FROM t ORDER BY `c` ASC FOR UPDATE'
		);
		expect(applySort('SELECT * FROM t', { column: 'we`ird', dir: 'asc' })).toBe(
			'SELECT * FROM t ORDER BY `we``ird` ASC'
		);
	});
	it('refuses complex queries', () => {
		expect(applySort('SELECT * FROM a, b', { column: 'a', dir: 'asc' })).toBeNull();
	});
	it('sortable fields', () => {
		expect(isSortableField('id', 'id')).toBe(true);
		expect(isSortableField('total', '')).toBe(true);
		expect(isSortableField('COUNT(*)', '')).toBe(false);
	});
});

describe('messages', () => {
	it('formats', () => {
		expect(affectedRowsMessage(1)).toBe('1 row affected.');
		expect(affectedRowsMessage(1500)).toBe('1,500 rows affected.');
		expect(showingRowsMessage({ from: 0, to: 24, total: 100, ms: 3.2 })).toBe(
			'Showing rows 0 - 24 (100 total, Query took 0.0032 seconds.)'
		);
		expect(errorMessage(1064, 'x')).toBe('#1064 - x');
	});
	it('locates syntax errors', () => {
		const sql = 'SELEC 1';
		const msg = "You have an error in your SQL syntax; check the manual near 'SELEC 1' at line 1";
		expect(locateSyntaxError(sql, 1064, msg)).toEqual({ start: 0, end: 7 });
		expect(locateSyntaxError(sql, 1146, msg)).toBeNull();
		expect(locateSyntaxError('SELECT', 1064, "near '' at line 1")).toEqual({ start: 6, end: 6 });
	});
	it('truncates', () => {
		expect(truncateSql('abcdef', 3)).toEqual({ text: 'abc', truncated: true });
		expect(truncateSql('abcdef', 0).truncated).toBe(false);
	});
});
