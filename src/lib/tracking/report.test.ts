import { describe, expect, it } from 'vitest';
import { parseLogType, reportEntries } from './report.ts';

const ddl = [{ date: '2024-01-01 10:00:00', username: 'a', statement: 'CREATE TABLE t (x int);' }];
const dml = [
	{ date: '2024-01-02 10:00:00', username: 'b', statement: 'INSERT INTO t VALUES (1);' },
	{ date: '2024-01-03 10:00:00', username: 'a', statement: 'DELETE FROM t;' }
];

describe('reportEntries', () => {
	it('picks the logs by type', () => {
		expect(reportEntries(ddl, dml, 'schema', {})).toHaveLength(1);
		expect(reportEntries(ddl, dml, 'data', {})).toHaveLength(2);
		expect(reportEntries(ddl, dml, 'schema_and_data', {}).map((e) => e.statement)).toEqual([
			'CREATE TABLE t (x int);',
			'INSERT INTO t VALUES (1);',
			'DELETE FROM t;'
		]);
	});
	it('applies date and user filters per log', () => {
		const e = reportEntries(ddl, dml, 'schema_and_data', {
			from: '2024-01-02 00:00:00',
			users: 'a'
		});
		expect(e.map((x) => x.statement)).toEqual(['DELETE FROM t;']);
		expect(e[0].id).toBe(1);
	});
	it('defaults the log type', () => {
		expect(parseLogType('nope')).toBe('schema_and_data');
		expect(parseLogType('data')).toBe('data');
	});
});
