import { describe, expect, it } from 'vitest';
import {
	buildPlan,
	formatRows,
	isApproximate,
	needsExactCount,
	operationSchema,
	planAddPrefix,
	planReplacePrefix,
	sizeAndOverhead,
	sortTables,
	validateRenames,
	type OperationInput,
	type RawTable
} from './structure';

const tables = [
	{ name: 'a_users', isView: false },
	{ name: 'a_posts', isView: false },
	{ name: 'b_misc', isView: false },
	{ name: 'v_all', isView: true }
];

const input = (o: Partial<OperationInput> & Pick<OperationInput, 'op' | 'selected'>) =>
	operationSchema.parse(o);

describe('row count display', () => {
	it('counts InnoDB tables only below MaxExactCount', () => {
		expect(needsExactCount('InnoDB', 100, 50000)).toBe(true);
		expect(needsExactCount('InnoDB', 50000, 50000)).toBe(false);
		expect(needsExactCount('InnoDB', null, 50000)).toBe(true);
		expect(needsExactCount('MyISAM', 5, 50000)).toBe(false);
		expect(needsExactCount('CSV', 5, 1)).toBe(true);
		expect(needsExactCount(null, 5, 50000)).toBe(false);
	});

	it('marks uncounted InnoDB numbers as approximate', () => {
		expect(isApproximate('InnoDB', false, false)).toBe(true);
		expect(isApproximate('InnoDB', false, true)).toBe(false);
		expect(isApproximate('MyISAM', false, false)).toBe(false);
		expect(isApproximate('InnoDB', true, false)).toBe(false);
	});

	it('formats the cell', () => {
		const f = (n: number) => String(n);
		expect(formatRows({ rows: 12, approx: false }, f)).toBe('12');
		expect(formatRows({ rows: 12, approx: true }, f)).toBe('~12');
		expect(formatRows({ rows: null, approx: false }, f)).toBe('-');
	});
});

describe('size and overhead', () => {
	it('uses data+index; overhead only for MyISAM-like engines', () => {
		expect(sizeAndOverhead('InnoDB', 100, 50, 999)).toEqual({ size: 150, overhead: 0 });
		expect(sizeAndOverhead('MyISAM', 100, 50, 20)).toEqual({ size: 150, overhead: 20 });
		expect(sizeAndOverhead('MERGE', 1, 1, 1)).toEqual({ size: null, overhead: 0 });
		expect(sizeAndOverhead(null, 1, 1, 1)).toEqual({ size: null, overhead: 0 });
	});
});

describe('sortTables', () => {
	const raw = (name: string, tableRows: number): RawTable => ({
		name,
		type: 'BASE TABLE',
		engine: 'InnoDB',
		tableRows,
		dataLength: 0,
		indexLength: 0,
		dataFree: 0,
		collation: null,
		comment: ''
	});
	it('sorts by name naturally and by rows', () => {
		const list = [raw('t10', 1), raw('t2', 5), raw('t1', 3)];
		expect(sortTables(list, 'name', 'asc').map((t) => t.name)).toEqual(['t1', 't2', 't10']);
		expect(sortTables(list, 'rows', 'desc').map((t) => t.name)).toEqual(['t2', 't1', 't10']);
	});
});

describe('prefix planning', () => {
	it('adds a prefix', () => {
		expect(planAddPrefix(['x', 'y'], 'p_')).toEqual([
			{ from: 'x', to: 'p_x' },
			{ from: 'y', to: 'p_y' }
		]);
	});
	it('replaces a prefix and skips non matching names', () => {
		expect(planReplacePrefix(['a_users', 'b_misc'], 'a_', 'z_')).toEqual([
			{ from: 'a_users', to: 'z_users' }
		]);
		expect(planReplacePrefix(['a_x'], 'a_', 'a_')).toEqual([]);
	});
	it('validates targets', () => {
		expect(validateRenames([], [])).toMatch(/No table name/);
		expect(validateRenames([{ from: 'a', to: 'b' }], ['a', 'b'])).toMatch(/already exists/);
		expect(
			validateRenames(
				[
					{ from: 'a', to: 'b' },
					{ from: 'c', to: 'b' }
				],
				['a', 'c']
			)
		).toMatch(/Duplicate/);
		expect(validateRenames([{ from: 'a', to: 'x'.repeat(65) }], ['a'])).toMatch(/Invalid/);
		expect(validateRenames([{ from: 'a', to: 'b' }], ['a'])).toBeNull();
		// swapping names inside the selection is not a conflict with an existing table
		expect(
			validateRenames(
				[
					{ from: 'a', to: 'b' },
					{ from: 'b', to: 'c' }
				],
				['a', 'b']
			)
		).toBeNull();
	});
});

describe('buildPlan', () => {
	const plan = (i: OperationInput, db: string | null = null) => {
		const r = buildPlan(i, tables, db);
		if (!r.ok) throw new Error(r.error);
		return r.plan;
	};

	it('drops tables and views in separate statements', () => {
		const p = plan(input({ op: 'drop', selected: ['a_users', 'v_all', 'b_misc'] }));
		expect(p.statements).toEqual(['DROP TABLE `a_users`, `b_misc`', 'DROP VIEW `v_all`']);
		expect(p.disableFk).toBe(false);
	});
	it('qualifies names for execution and disables fk checks on request', () => {
		const p = plan(input({ op: 'drop', selected: ['a_users'], fk_checks: false }), 'my`db');
		expect(p.statements).toEqual(['DROP TABLE `my``db`.`a_users`']);
		expect(p.disableFk).toBe(true);
	});
	it('empties tables but never views', () => {
		expect(plan(input({ op: 'empty', selected: ['a_users', 'v_all'] })).statements).toEqual([
			'TRUNCATE `a_users`'
		]);
		const r = buildPlan(input({ op: 'empty', selected: ['v_all'] }), tables, null);
		expect(r.ok).toBe(false);
	});
	it('builds maintenance statements (views only for check/checksum)', () => {
		const sel = ['a_users', 'v_all'];
		expect(plan(input({ op: 'optimize', selected: sel })).statements).toEqual([
			'OPTIMIZE TABLE `a_users`'
		]);
		expect(plan(input({ op: 'check', selected: sel })).statements).toEqual([
			'CHECK TABLE `a_users`, `v_all`'
		]);
		expect(plan(input({ op: 'analyze', selected: sel })).statements[0]).toMatch(/^ANALYZE TABLE/);
		expect(plan(input({ op: 'repair', selected: sel })).statements[0]).toMatch(/^REPAIR TABLE/);
		expect(plan(input({ op: 'checksum', selected: sel })).statements[0]).toMatch(/^CHECKSUM TABLE/);
	});
	it('builds rename statements (RENAME TABLE for views)', () => {
		expect(
			plan(input({ op: 'add_prefix', selected: ['a_users', 'v_all'], prefix: 'p_' })).statements
		).toEqual(['ALTER TABLE `a_users` RENAME `p_a_users`', 'RENAME TABLE `v_all` TO `p_v_all`']);
		expect(
			plan(
				input({
					op: 'replace_prefix',
					selected: ['a_users', 'b_misc'],
					from_prefix: 'a_',
					to_prefix: 'z_'
				})
			).statements
		).toEqual(['ALTER TABLE `a_users` RENAME `z_users`']);
	});
	it('rejects empty prefixes and unknown tables', () => {
		expect(buildPlan(input({ op: 'add_prefix', selected: ['a_users'] }), tables, null).ok).toBe(
			false
		);
		expect(buildPlan(input({ op: 'drop', selected: ['nope'] }), tables, null).ok).toBe(false);
	});
	it('builds copy with prefix', () => {
		const p = plan(
			input({
				op: 'copy_prefix',
				selected: ['a_users', 'v_all'],
				from_prefix: 'a_',
				to_prefix: 'c_',
				drop_if_exists: true
			})
		);
		expect(p.statements).toEqual([
			'DROP TABLE IF EXISTS `c_users`',
			'CREATE TABLE `c_users` LIKE `a_users`',
			'INSERT INTO `c_users` SELECT * FROM `a_users`'
		]);
	});
	it('builds show create', () => {
		expect(plan(input({ op: 'show_create', selected: ['a_users', 'v_all'] })).statements).toEqual([
			'SHOW CREATE TABLE `a_users`',
			'SHOW CREATE VIEW `v_all`'
		]);
	});
});
