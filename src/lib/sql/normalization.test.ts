import { describe, expect, it } from 'vitest';
import {
	buildDistinctCountQuery,
	checkNames,
	groupDependencies,
	isDependent,
	keyName,
	partialKeys,
	planDecomposition,
	planRepeatingGroup
} from './normalization.ts';

describe('partialKeys', () => {
	it('lists proper non-empty subsets', () => {
		expect(partialKeys(['a'])).toEqual([]);
		expect(partialKeys(['a', 'b']).map(keyName).sort()).toEqual(['a', 'b']);
		expect(partialKeys(['a', 'b', 'c'])).toHaveLength(6);
	});
});

describe('dependency detection', () => {
	it('builds the count query', () => {
		expect(buildDistinctCountQuery('d', 't', [['a', 'b'], ['c']])).toBe(
			'SELECT COUNT(DISTINCT `a`, `b`) AS c0, COUNT(DISTINCT `c`) AS c1 FROM (SELECT * FROM `d`.`t` LIMIT 500) AS dt'
		);
	});
	it('checks counts', () => {
		expect(isDependent({ keyCount: 3, colCount: 3, pairCount: 3, totalRows: 9 })).toBe(true);
		expect(isDependent({ keyCount: 3, colCount: 4, pairCount: 5, totalRows: 9 })).toBe(false);
		expect(isDependent({ keyCount: 9, colCount: 2, pairCount: 9, totalRows: 9 })).toBe(true);
		expect(isDependent({ keyCount: 0, colCount: 0, pairCount: 0, totalRows: 0 })).toBe(false);
	});
});

describe('decomposition', () => {
	const cols = ['order_id', 'product_id', 'qty', 'product_name'];
	const answers = [
		{ column: 'qty', dependsOn: [] },
		{ column: 'product_name', dependsOn: ['product_id'] }
	];
	it('groups answers', () => {
		expect(groupDependencies('t', ['order_id', 'product_id'], answers)).toEqual([
			{ key: ['order_id', 'product_id'], dependents: ['qty'], name: 't' },
			{ key: ['product_id'], dependents: ['product_name'], name: 't_2' }
		]);
	});
	it('plans create, key and drop', () => {
		const g = groupDependencies('t', ['order_id', 'product_id'], answers, {
			product_id: 'products'
		});
		expect(planDecomposition('d', 't', cols, g)).toEqual([
			'CREATE TABLE `d`.`products` SELECT DISTINCT `product_id`, `product_name` FROM `d`.`t`;',
			'ALTER TABLE `d`.`products` ADD PRIMARY KEY (`product_id`);',
			'ALTER TABLE `d`.`t`\n  DROP `product_name`;'
		]);
	});
	it('drops the original when renamed', () => {
		const sql = planDecomposition(
			'd',
			't',
			['a', 'b'],
			[{ key: ['a'], dependents: ['b'], name: 'n' }]
		);
		expect(sql.at(-1)).toBe('DROP TABLE `d`.`t`;');
	});
});

describe('repeating group', () => {
	it('unions the columns', () => {
		const sql = planRepeatingGroup('d', 't', ['id'], ['a1', 'a2'], 'authors', 'author');
		expect(sql[0]).toBe(
			'CREATE TABLE `d`.`authors` SELECT `id`, `a1` AS `author` FROM `d`.`t` UNION SELECT `id`, `a2` AS `author` FROM `d`.`t`;'
		);
		expect(sql[1]).toContain('DROP `a1`');
	});
});

describe('checkNames', () => {
	const g = (...n: string[]) => n.map((name) => ({ key: ['a'], dependents: [], name }));
	it('validates', () => {
		expect(checkNames('t', g('t', 'x'), ['t'])).toBe('');
		expect(checkNames('t', g('t', 't2'), ['t', 't2'])).toContain('already exists');
		expect(checkNames('t', g('x', 'X'), [])).toContain('twice');
		expect(checkNames('t', g(''), [])).toContain('name');
	});
});
