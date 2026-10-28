import { describe, expect, it } from 'vitest';
import { filterNames, groupDatabases } from './grouping';

const on = { enabled: true, separator: '_' };

describe('groupDatabases', () => {
	it('groups databases sharing a prefix', () => {
		expect(groupDatabases(['information_schema', 'sma_other', 'sma_test'], on)).toEqual([
			{ kind: 'db', name: 'information_schema', label: 'information_schema' },
			{
				kind: 'group',
				prefix: 'sma',
				children: [
					{ kind: 'db', name: 'sma_other', label: 'other' },
					{ kind: 'db', name: 'sma_test', label: 'test' }
				]
			}
		]);
	});

	it('keeps singletons, separator-less and edge names ungrouped', () => {
		const out = groupDatabases(['mysql', '_x', 'y_', 'solo_one'], on);
		expect(out.every((e) => e.kind === 'db')).toBe(true);
		expect(out.map((e) => (e.kind === 'db' ? e.name : ''))).toEqual([
			'mysql',
			'_x',
			'y_',
			'solo_one'
		]);
	});

	it('places a group where its first member was and supports long separators', () => {
		const out = groupDatabases(['a--1', 'z', 'a--2'], { enabled: true, separator: '--' });
		expect(out.map((e) => e.kind)).toEqual(['group', 'db']);
		expect(out[0]).toMatchObject({ prefix: 'a', children: [{ label: '1' }, { label: '2' }] });
	});

	it('is a flat list when disabled or without separator', () => {
		const names = ['sma_a', 'sma_b'];
		expect(groupDatabases(names, { enabled: false, separator: '_' })).toHaveLength(2);
		expect(groupDatabases(names, { enabled: true, separator: '' })).toHaveLength(2);
	});
});

describe('filterNames', () => {
	it('filters case-insensitively and keeps all for blank queries', () => {
		expect(filterNames(['Books', 'authors'], 'BOO')).toEqual(['Books']);
		expect(filterNames(['a', 'b'], '  ')).toEqual(['a', 'b']);
	});
});
