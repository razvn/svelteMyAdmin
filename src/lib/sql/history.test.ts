import { describe, expect, it } from 'vitest';
import { filterHistory, pushHistory, shouldRecord, type HistoryEntry } from './history.ts';

const e = (sqlquery: string, db = '', table = ''): HistoryEntry => ({
	db,
	table,
	sqlquery,
	timevalue: ''
});

describe('history', () => {
	it('keeps the newest entries within the maximum', () => {
		let list: HistoryEntry[] = [];
		for (const q of ['a', 'b', 'c', 'd']) list = pushHistory(list, e(q), 3);
		expect(list.map((x) => x.sqlquery)).toEqual(['b', 'c', 'd']);
	});

	it('never shrinks below one entry', () => {
		expect(pushHistory([e('a')], e('b'), 0).map((x) => x.sqlquery)).toEqual(['b']);
	});

	it('skips empty and over-long statements', () => {
		expect(shouldRecord('  ', 1000)).toBe(false);
		expect(shouldRecord('SELECT 1', 1000)).toBe(true);
		expect(shouldRecord('SELECT 12345', 5)).toBe(false);
		expect(shouldRecord('SELECT 12345', 0)).toBe(true);
	});

	it('filters by query, db and table', () => {
		const list = [e('SELECT 1', 'shop', 'books'), e('SHOW TABLES', 'blog')];
		expect(filterHistory(list, 'select')).toHaveLength(1);
		expect(filterHistory(list, 'BLOG')).toHaveLength(1);
		expect(filterHistory(list, 'books')).toHaveLength(1);
		expect(filterHistory(list, '')).toHaveLength(2);
	});
});
