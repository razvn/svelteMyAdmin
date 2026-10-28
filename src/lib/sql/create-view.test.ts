import { describe, expect, it } from 'vitest';
import { buildCreateView, splitColumnNames, type CreateViewForm } from './create-view.ts';

const form = (o: Partial<CreateViewForm> = {}): CreateViewForm => ({
	name: 'v1',
	orReplace: false,
	algorithm: '',
	definer: '',
	sqlSecurity: '',
	columnNames: '',
	as: 'SELECT 1',
	withCheck: '',
	...o
});

describe('buildCreateView', () => {
	it('builds the minimal statement', () => {
		expect(buildCreateView(form())).toEqual({ sql: 'CREATE VIEW `v1` AS SELECT 1', error: null });
	});

	it('adds every option in phpMyAdmin order', () => {
		const r = buildCreateView(
			form({
				name: 'my`v',
				orReplace: true,
				algorithm: 'MERGE',
				definer: 'root@localhost',
				sqlSecurity: 'INVOKER',
				columnNames: ' a , b ,',
				as: 'SELECT x, y FROM t;',
				withCheck: 'CASCADED'
			})
		);
		expect(r.sql).toBe(
			'CREATE OR REPLACE ALGORITHM = MERGE DEFINER=`root`@`localhost` SQL SECURITY INVOKER ' +
				'VIEW `my``v` (`a`, `b`) AS SELECT x, y FROM t WITH CASCADED CHECK OPTION'
		);
	});

	it('rejects an empty name, an empty query and a malformed definer', () => {
		expect(buildCreateView(form({ name: ' ' })).error).toMatch(/name/);
		expect(buildCreateView(form({ as: ' ; ' })).error).toMatch(/SELECT/);
		expect(buildCreateView(form({ definer: 'a@b@c@' })).error).toMatch(/definer/);
	});

	it('splits column names', () => {
		expect(splitColumnNames('a, b,,c')).toEqual(['a', 'b', 'c']);
	});
});
