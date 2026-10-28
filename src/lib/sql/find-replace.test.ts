import { describe, expect, it } from 'vitest';
import {
	buildFindReplaceSql,
	isReplaceableType,
	likePattern,
	supportsRegexReplace
} from './find-replace.ts';

const req = {
	db: 'd',
	table: 't',
	column: 'name',
	find: 'a_b',
	replaceWith: 'x',
	useRegex: false
};
const mysql = { isMariaDB: false, versionInt: 80404, charset: 'utf8mb4' };
const maria = { isMariaDB: true, versionInt: 110402, charset: 'utf8mb4' };

describe('find and replace SQL', () => {
	it('plain replace uses REPLACE and a binary LIKE with escaped wildcards', () => {
		const s = buildFindReplaceSql(req, mysql);
		expect(s.update.sql).toBe(
			'UPDATE `d`.`t` SET `name` = REPLACE(`name`, ?, ?) WHERE `name` LIKE ? COLLATE utf8mb4_bin'
		);
		expect(s.update.params).toEqual(['a_b', 'x', '%a\\_b%']);
		expect(s.count.params).toEqual(['%a\\_b%']);
		expect(s.preview.sql).toContain('GROUP BY `name` ORDER BY `name` ASC LIMIT 100');
	});
	it('regex on MySQL is case sensitive via match type c', () => {
		const s = buildFindReplaceSql(
			{ ...req, find: '^a(.)', replaceWith: '$1', useRegex: true },
			mysql
		);
		expect(s.update.sql).toBe(
			"UPDATE `d`.`t` SET `name` = REGEXP_REPLACE(`name`, ?, ?, 1, 0, 'c') WHERE REGEXP_LIKE(`name`, ?, 'c')"
		);
		expect(s.update.params).toEqual(['^a(.)', '$1', '^a(.)']);
	});
	it('regex on MariaDB turns case insensitivity off in the pattern', () => {
		const s = buildFindReplaceSql({ ...req, find: 'a+', useRegex: true }, maria);
		expect(s.update.sql).toBe(
			'UPDATE `d`.`t` SET `name` = REGEXP_REPLACE(`name`, ?, ?) WHERE `name` REGEXP ?'
		);
		expect(s.update.params).toEqual(['(?-i)a+', 'x', '(?-i)a+']);
	});
	it('rejects regex on old servers, empty find and odd charsets', () => {
		expect(() =>
			buildFindReplaceSql({ ...req, useRegex: true }, { ...mysql, versionInt: 50700 })
		).toThrow();
		expect(() => buildFindReplaceSql({ ...req, find: '' }, mysql)).toThrow();
		expect(() => buildFindReplaceSql(req, { ...mysql, charset: "x'; --" })).toThrow();
		expect(supportsRegexReplace({ isMariaDB: true, versionInt: 100005 })).toBe(true);
	});
	it('escapes identifiers', () => {
		const s = buildFindReplaceSql({ ...req, db: 'd`b', column: 'c`' }, mysql);
		expect(s.update.sql).toContain('`d``b`.`t`');
		expect(s.update.sql).toContain('`c```');
	});
	it('likePattern and replaceable types', () => {
		expect(likePattern('50%_\\')).toBe('%50\\%\\_\\\\%');
		expect(isReplaceableType('varchar(20)')).toBe(true);
		expect(isReplaceableType('longtext')).toBe(true);
		expect(isReplaceableType('blob')).toBe(false);
		expect(isReplaceableType("enum('a')")).toBe(false);
		expect(isReplaceableType('int(11)')).toBe(false);
	});
});
