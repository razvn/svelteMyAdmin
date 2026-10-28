import { describe, expect, it } from 'vitest';
import {
	buildCriterionClause,
	buildWhereBody,
	baseColumnType,
	getGeometryFunctions,
	getTypeOperators,
	normalizeColumnType,
	parseEnumSetValues,
	type Criterion
} from './table-search.ts';

const c = (
	type: string,
	operator: string,
	value: string | string[] = '',
	extra: Partial<Criterion> = {}
): Criterion => ({ column: 'col', type, operator, value, ...extra });
const sql = (x: Criterion) => buildCriterionClause(x);

describe('type operators', () => {
	it('uses text operators for char types and number operators otherwise', () => {
		expect(getTypeOperators('varchar', false)).toContain('REGEXP');
		expect(getTypeOperators('varchar', false)).toContain("= ''");
		expect(getTypeOperators('text', false)).toContain('NOT REGEXP');
		expect(getTypeOperators('int', false)).toEqual([
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
		]);
		expect(getTypeOperators('datetime', false)).toContain('>=');
		expect(getTypeOperators('point', false)).toContain('BETWEEN');
	});
	it('enum, uuid and nullable', () => {
		expect(getTypeOperators("enum('a','b')", false)).toEqual(['=', '!=']);
		expect(getTypeOperators('uuid', false)).toEqual([
			'=',
			'!=',
			'LIKE',
			'LIKE %...%',
			'NOT LIKE',
			'NOT LIKE %...%',
			'IN (...)',
			'NOT IN (...)'
		]);
		expect(getTypeOperators("enum('a')", true)).toEqual(['=', '!=', 'IS NULL', 'IS NOT NULL']);
		expect(getTypeOperators('int', true).slice(-2)).toEqual(['IS NULL', 'IS NOT NULL']);
	});
	it('normalizes column types', () => {
		expect(normalizeColumnType('INT(10) UNSIGNED ZEROFILL')).toBe('int(10)');
		expect(normalizeColumnType('varbinary(64)')).toBe('varbinary(64)');
		expect(normalizeColumnType("enum('a','b')")).toBe("enum('a', 'b')");
		expect(baseColumnType('decimal(8,2)')).toBe('decimal');
	});
	it('parses enum values', () => {
		expect(parseEnumSetValues("enum('a', 'it''s', 'c,d')")).toEqual(['a', "it's", 'c,d']);
	});
});

describe('buildCriterionClause', () => {
	it('simple comparisons quote text, not numbers', () => {
		expect(sql(c('varchar(20)', '=', 'x'))).toBe("`col` = 'x'");
		expect(sql(c('int(11)', '>=', '5'))).toBe('`col` >= 5');
		expect(sql(c('decimal(8,2)', '<', '-1.5'))).toBe('`col` < -1.5');
		expect(sql(c('date', '!=', '2024-01-01'))).toBe("`col` != '2024-01-01'");
	});
	it('does not splice non-numeric text into numeric comparisons', () => {
		expect(sql(c('int', '=', '1 OR 1=1'))).toBe("`col` = '1 OR 1=1'");
	});
	it('escapes quotes and backslashes', () => {
		expect(sql(c('varchar', '=', "O'B\\"))).toBe("`col` = 'O\\'B\\\\'");
	});
	it('quotes identifiers with backticks', () => {
		expect(buildCriterionClause({ ...c('int', '=', '1'), column: 'a`b' })).toBe('`a``b` = 1');
	});
	it('LIKE variants always quote and wrap', () => {
		expect(sql(c('int', 'LIKE', '1%'))).toBe("`col` LIKE '1%'");
		expect(sql(c('varchar', 'LIKE %...%', 'ab'))).toBe("`col` LIKE '%ab%'");
		expect(sql(c('varchar', 'NOT LIKE %...%', 'ab'))).toBe("`col` NOT LIKE '%ab%'");
		expect(sql(c('varchar', 'NOT LIKE', 'a_'))).toBe("`col` NOT LIKE 'a_'");
		expect(sql(c('varchar', 'LIKE %...%', "50%'"))).toBe("`col` LIKE '%50%\\'%'");
	});
	it('REGEXP variants', () => {
		expect(sql(c('varchar', 'REGEXP', 'a.c'))).toBe("`col` REGEXP 'a.c'");
		expect(sql(c('varchar', 'REGEXP ^...$', 'abc'))).toBe("`col` REGEXP '^abc$'");
		expect(sql(c('varchar', 'NOT REGEXP', 'x'))).toBe("`col` NOT REGEXP 'x'");
	});
	it('unary operators ignore the value', () => {
		expect(sql(c('varchar', 'IS NULL'))).toBe('`col` IS NULL');
		expect(sql(c('varchar', 'IS NOT NULL', 'ignored'))).toBe('`col` IS NOT NULL');
		expect(sql(c('varchar', "= ''"))).toBe("`col` = ''");
		expect(sql(c('varchar', "!= ''"))).toBe("`col` != ''");
	});
	it('empty value skips the criterion', () => {
		expect(sql(c('varchar', '='))).toBe('');
		expect(sql(c('int', 'BETWEEN', ['', '']))).toBe('');
	});
	it('IN / NOT IN split on commas, trim, and map empty to NULL', () => {
		expect(sql(c('int', 'IN (...)', '1, 2,3'))).toBe('`col` IN (1,2,3)');
		expect(sql(c('varchar', 'NOT IN (...)', "a,b'c"))).toBe("`col` NOT IN ('a','b\\'c')");
		expect(sql(c('varchar', 'IN (...)', 'a,,b'))).toBe("(`col` IN ('a','b') OR `col` IS NULL)");
		expect(sql(c('varchar', 'IN (...)', ',x'))).toBe("(`col` IN ('x') OR `col` IS NULL)");
		expect(sql(c('varchar', 'IN (...)', ','))).toBe('`col` IS NULL');
	});
	it('BETWEEN from an array or a comma list', () => {
		expect(sql(c('int', 'BETWEEN', ['1', '9']))).toBe('`col` BETWEEN 1 AND 9');
		expect(sql(c('int', 'NOT BETWEEN', '1,9'))).toBe('`col` NOT BETWEEN 1 AND 9');
		expect(sql(c('date', 'BETWEEN', ['2020-01-01', '2020-12-31']))).toBe(
			"`col` BETWEEN '2020-01-01' AND '2020-12-31'"
		);
		expect(sql(c('int', 'BETWEEN', ['1', '']))).toBe('`col` BETWEEN 1 AND NULL');
	});
	it('enum: single value, several values become IN', () => {
		const t = "enum('a','b','c')";
		expect(sql(c(t, '=', 'a'))).toBe("`col` = 'a'");
		expect(sql(c(t, '!=', ['a', 'b']))).toBe("`col` NOT IN ('a', 'b')");
		expect(sql(c(t, '=', ['a', 'b']))).toBe("`col` IN ('a', 'b')");
		expect(sql(c(t, '=', ['', 'c']))).toBe("`col` = 'c'");
		expect(sql(c(t, '=', ''))).toBe('');
	});
});

describe('geometry', () => {
	const geomType = 'geometry';
	it('lists type specific functions with ST_ names', () => {
		const names = (t: string, m = false) => getGeometryFunctions(t, m).map((f) => f.name);
		expect(names('point')).toContain('ST_X');
		expect(names('point')).not.toContain('ST_Area');
		expect(names('polygon')).toContain('ST_Area');
		expect(names('linestring')).not.toContain('ST_IsRing');
		expect(names('linestring', true)).toContain('ST_IsRing');
		expect(names('geometry')).toContain('MBRContains');
		expect(getGeometryFunctions('geometry').find((f) => f.name === 'ST_Contains')?.params).toBe(2);
	});
	it('binary function builds ST_GeomFromText from WKT', () => {
		expect(sql(c(geomType, '=', 'POINT(1 2)', { geomFunc: 'ST_Contains' }))).toBe(
			"ST_Contains(`col`, ST_GeomFromText('POINT(1 2)'))"
		);
		expect(sql(c(geomType, '=', "'POINT(1 2)',4326", { geomFunc: 'ST_Within' }))).toBe(
			"ST_Within(`col`, ST_GeomFromText('POINT(1 2)', 4326))"
		);
		expect(sql(c(geomType, '=', '', { geomFunc: 'ST_Within' }))).toBe('');
	});
	it('does not splice raw SQL', () => {
		expect(sql(c(geomType, '=', "1') OR ('1'='1", { geomFunc: 'ST_Within' }))).toBe(
			"ST_Within(`col`, '1\\') OR (\\'1\\'=\\'1')"
		);
	});
	it('unary functions', () => {
		expect(sql(c('point', '=', '', { geomFunc: 'ST_IsEmpty' }))).toBe('ST_IsEmpty(`col`)');
		expect(sql(c('point', '>', '3', { geomFunc: 'ST_X' }))).toBe("ST_X(`col`) > '3'");
		expect(sql(c('polygon', '=', 'POLYGON((0 0,1 0,1 1,0 0))', { geomFunc: 'ST_Envelope' }))).toBe(
			"ST_Envelope(`col`) = ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 0))')"
		);
		expect(sql(c('point', 'IS NULL', '', { geomFunc: 'ST_X' }))).toBe('`col` IS NULL');
	});
	it('ignores unknown functions', () => {
		expect(sql(c('point', '=', 'x', { geomFunc: 'Evil(1)' }))).toBe('');
	});
});

describe('buildWhereBody', () => {
	it('joins with AND and skips empty criteria', () => {
		expect(
			buildWhereBody([c('int', '>', '1'), c('varchar', '=', ''), c('varchar', 'LIKE', 'a%')])
		).toBe("`col` > 1 AND `col` LIKE 'a%'");
	});
	it('custom where wins', () => {
		expect(buildWhereBody([c('int', '>', '1')], '  id < 3 ')).toBe('id < 3');
		expect(buildWhereBody([c('int', '>', '1')], '   ')).toBe('`col` > 1');
	});
	it('empty when nothing to filter', () => {
		expect(buildWhereBody([])).toBe('');
	});
});
