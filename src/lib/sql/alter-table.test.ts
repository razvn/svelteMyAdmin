import { describe, expect, it } from 'vitest';
import { newColumn, type ColumnDef, type ServerCaps } from './column-definition.ts';
import {
	buildAddColumns,
	buildChangeColumns,
	buildDropColumns,
	buildMoveColumns,
	isPermutation
} from './alter-table.ts';

const caps: ServerCaps = { serverType: 'MySQL', version: 80404 };
const col = (name: string, o: Partial<ColumnDef> = {}) => newColumn({ name, ...o });

describe('buildAddColumns', () => {
	it('adds at the end', () => {
		expect(buildAddColumns('d', 't', [col('a'), col('b', { type: 'TEXT' })], caps)).toBe(
			'ALTER TABLE `d`.`t`\n  ADD `a` INT NOT NULL,\n  ADD `b` TEXT NOT NULL;'
		);
	});
	it('FIRST then chains the others after the previous', () => {
		const sql = buildAddColumns('d', 't', [col('a'), col('b')], caps, { where: 'first' });
		expect(sql).toContain('ADD `a` INT NOT NULL FIRST');
		expect(sql).toContain('ADD `b` INT NOT NULL AFTER `a`');
	});
	it('AFTER a column', () => {
		const sql = buildAddColumns('d', 't', [col('a'), col('b')], caps, {
			where: 'after',
			after: 'x`y'
		});
		expect(sql).toContain('ADD `a` INT NOT NULL AFTER `x``y`');
		expect(sql).toContain('ADD `b` INT NOT NULL AFTER `a`');
	});
	it('appends key definitions and skips unnamed columns', () => {
		const sql = buildAddColumns('d', 't', [col('a', { index: 'UNIQUE' }), col('')], caps);
		expect(sql).toBe('ALTER TABLE `d`.`t`\n  ADD `a` INT NOT NULL,\n  ADD UNIQUE (`a`);');
	});
	it('auto-increment gets a PRIMARY KEY only when the table has none', () => {
		const a = col('id', { autoIncrement: true });
		expect(buildAddColumns('d', 't', [a], caps)).toContain('ADD PRIMARY KEY (`id`)');
		expect(
			buildAddColumns('d', 't', [a], caps, { where: 'end' }, { tableHasPrimary: true })
		).not.toContain('PRIMARY KEY');
	});
});

describe('buildChangeColumns', () => {
	it('renames and redefines several columns', () => {
		const sql = buildChangeColumns(
			'd',
			't',
			[
				{ oldName: 'a', col: col('a2', { type: 'VARCHAR', length: '20', null: true }) },
				{ oldName: 'b', col: col('b', { comment: "it's" }) }
			],
			caps
		);
		expect(sql).toBe(
			"ALTER TABLE `d`.`t`\n  CHANGE `a` `a2` VARCHAR(20) NULL,\n  CHANGE `b` `b` INT NOT NULL COMMENT 'it\\'s';"
		);
	});
});

describe('buildDropColumns', () => {
	it('drops several', () => {
		expect(buildDropColumns('d', 't', ['a', 'b`c'])).toBe(
			'ALTER TABLE `d`.`t`\n  DROP `a`,\n  DROP `b``c`;'
		);
	});
});

describe('buildMoveColumns', () => {
	const cur = [col('a'), col('b'), col('c'), col('d')];
	it('is empty when nothing moves', () => {
		expect(buildMoveColumns('d', 't', cur, ['a', 'b', 'c', 'd'], caps)).toBe('');
	});
	it('moves one column to the front', () => {
		expect(buildMoveColumns('d', 't', cur, ['c', 'a', 'b', 'd'], caps)).toBe(
			'ALTER TABLE `d`.`t`\n  MODIFY `c` INT NOT NULL FIRST;'
		);
	});
	it('moves one column to the end', () => {
		expect(buildMoveColumns('d', 't', cur, ['b', 'c', 'd', 'a'], caps)).toBe(
			'ALTER TABLE `d`.`t`\n  MODIFY `b` INT NOT NULL FIRST,\n  MODIFY `c` INT NOT NULL AFTER `b`,\n  MODIFY `d` INT NOT NULL AFTER `c`;'
		);
	});
	it('reverses', () => {
		const sql = buildMoveColumns('d', 't', cur, ['d', 'c', 'b', 'a'], caps);
		expect(sql.match(/MODIFY/g)).toHaveLength(3);
		expect(sql).toContain('MODIFY `d` INT NOT NULL FIRST');
	});
	it('isPermutation', () => {
		expect(isPermutation(['a', 'b'], ['b', 'a'])).toBe(true);
		expect(isPermutation(['a', 'b'], ['b', 'b'])).toBe(false);
		expect(isPermutation(['a', 'b'], ['a'])).toBe(false);
	});
});
