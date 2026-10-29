import { describe, expect, it } from 'vitest';
import {
	analyseStatement,
	filterEntries,
	logChunk,
	parseLog,
	parseUse,
	phpSerialize,
	phpUnserialize,
	serializeLog
} from './analyse.ts';

describe('analyseStatement', () => {
	it.each([
		['CREATE TABLE `t1` (id int)', 'CREATE TABLE', undefined, 't1'],
		['create table if not exists db1.t1 (id int)', 'CREATE TABLE', 'db1', 't1'],
		['CREATE TEMPORARY TABLE `a``b` (x int)', 'CREATE TABLE', undefined, 'a`b'],
		['ALTER TABLE `d`.`t` ADD c int', 'ALTER TABLE', 'd', 't'],
		['DROP TABLE IF EXISTS t', 'DROP TABLE', undefined, 't'],
		['DROP VIEW v', 'DROP VIEW', undefined, 'v'],
		['CREATE OR REPLACE ALGORITHM=MERGE VIEW v AS SELECT 1', 'CREATE VIEW', undefined, 'v'],
		['CREATE UNIQUE INDEX i ON t (a)', 'CREATE INDEX', undefined, 't'],
		['DROP INDEX i ON `x`.`t`', 'DROP INDEX', 'x', 't'],
		['INSERT INTO t VALUES (1)', 'INSERT', undefined, 't'],
		['INSERT t (a) VALUES (1)', 'INSERT', undefined, 't'],
		['REPLACE INTO t VALUES (1)', 'REPLACE', undefined, 't'],
		['UPDATE `t` SET a = 1', 'UPDATE', undefined, 't'],
		['DELETE FROM d.t WHERE 1', 'DELETE', 'd', 't'],
		['TRUNCATE TABLE t', 'TRUNCATE', undefined, 't'],
		['/* hi */ -- c\n INSERT INTO t VALUES (1)', 'INSERT', undefined, 't']
	])('%s', (sql, identifier, db, table) => {
		const a = analyseStatement(sql);
		expect(a?.identifier).toBe(identifier);
		expect(a?.db).toBe(db);
		expect(a?.table).toBe(table);
	});

	it('types', () => {
		expect(analyseStatement('INSERT INTO t VALUES (1)')?.type).toBe('DML');
		expect(analyseStatement('DROP TABLE t')?.type).toBe('DDL');
	});

	it('database statements have an empty table', () => {
		expect(analyseStatement('CREATE DATABASE IF NOT EXISTS `x y`')).toMatchObject({
			identifier: 'CREATE DATABASE',
			db: 'x y',
			table: ''
		});
		expect(analyseStatement('DROP SCHEMA z')).toMatchObject({
			identifier: 'DROP DATABASE',
			db: 'z'
		});
	});

	it('rename', () => {
		expect(analyseStatement('RENAME TABLE a TO b')).toMatchObject({
			identifier: 'RENAME TABLE',
			table: 'a',
			tableAfterRename: 'b'
		});
	});

	it('ignores everything else', () => {
		expect(analyseStatement('SELECT * FROM t')).toBeNull();
		expect(analyseStatement('SHOW TABLES')).toBeNull();
		expect(analyseStatement('CREATE PROCEDURE p() SELECT 1')).toBeNull();
	});

	it('parseUse', () => {
		expect(parseUse('USE `my db`')).toBe('my db');
		expect(parseUse('use x;')).toBe('x');
		expect(parseUse('SELECT 1')).toBeNull();
	});
});

describe('tracking log', () => {
	it('logChunk follows the phpMyAdmin format and strips the db prefix', () => {
		expect(logChunk('2024-01-02 03:04:05', 'root', 'INSERT INTO `d`.`t` VALUES (1)', 'd')).toBe(
			'# log 2024-01-02 03:04:05 root\nINSERT INTO `t` VALUES (1);\n'
		);
		expect(logChunk('2024-01-02 03:04:05', 'a  b', 'DELETE FROM t;', 'd')).toBe(
			'# log 2024-01-02 03:04:05 a b\nDELETE FROM t;'
		);
	});

	const log =
		'\n# log 2024-01-01 10:00:00 alice\nCREATE TABLE t (a int);\n' +
		'\n# log 2024-01-02 10:00:00 bob\nDROP TABLE t;';

	it('parses entries', () => {
		const e = parseLog(log);
		expect(e).toEqual([
			{ date: '2024-01-01 10:00:00', username: 'alice', statement: 'CREATE TABLE t (a int);' },
			{ date: '2024-01-02 10:00:00', username: 'bob', statement: 'DROP TABLE t;' }
		]);
		expect(parseLog(serializeLog(e))).toEqual(e);
		expect(parseLog(null)).toEqual([]);
	});

	it('filters by date range and user', () => {
		const e = parseLog(log);
		expect(filterEntries(e, {}).map((x) => x.id)).toEqual([0, 1]);
		expect(filterEntries(e, { from: '2024-01-02 00:00:00' }).map((x) => x.id)).toEqual([1]);
		expect(filterEntries(e, { to: '2024-01-01 23:59:59' }).map((x) => x.id)).toEqual([0]);
		expect(filterEntries(e, { users: 'alice' }).map((x) => x.id)).toEqual([0]);
		expect(filterEntries(e, { users: 'alice, bob' }).map((x) => x.id)).toEqual([0, 1]);
		expect(filterEntries(e, { users: '*' })).toHaveLength(2);
		expect(filterEntries(e, { users: 'nobody' })).toHaveLength(0);
	});
});

describe('php serialize', () => {
	it('round trips the snapshot shape', () => {
		const v = {
			COLUMNS: [{ Field: 'id', Type: 'int(11)', Null: 'NO', Default: null, Comment: 'é' }],
			INDEXES: []
		};
		const s = phpSerialize(v);
		expect(s).toContain('s:7:"COLUMNS";a:1:{i:0;a:5:{');
		expect(s).toContain('s:2:"é"');
		expect(phpUnserialize(s)).toEqual(v);
	});
	it('rejects garbage', () => {
		expect(phpUnserialize('zzz')).toBeUndefined();
		expect(phpUnserialize('')).toBeUndefined();
	});
});
