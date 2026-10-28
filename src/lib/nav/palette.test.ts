import { describe, expect, it } from 'vitest';
import { rankItems, scoreToken, type PaletteItem } from './palette';

const item = (label: string, kind: PaletteItem['kind'] = 'table', description?: string) => ({
	id: `${kind}:${label}`,
	kind,
	label,
	description,
	href: `/${label}`
});

describe('scoreToken', () => {
	it('orders exact > prefix > word boundary > substring > fuzzy > none', () => {
		const s = (t: string) => scoreToken('book', t);
		expect(s('book')).toBeGreaterThan(s('books'));
		expect(s('books')).toBeGreaterThan(s('my_book'));
		expect(s('my_book')).toBeGreaterThan(s('mybook'));
		expect(s('mybook')).toBeGreaterThan(s('b_o_o_k'));
		expect(s('b_o_o_k')).toBeGreaterThan(0);
		expect(s('authors')).toBe(0);
	});
	it('is case-insensitive', () => {
		expect(scoreToken('BOOKS', 'books')).toBe(1000);
	});
});

describe('rankItems', () => {
	const items = [
		item('authors'),
		item('book_authors'),
		item('books'),
		item('sma_test', 'database'),
		item('Structure', 'tab', 'Database sma_test')
	];

	it('puts the best match first', () => {
		expect(rankItems(items, 'books')[0].label).toBe('books');
		expect(rankItems(items, 'book').map((i) => i.label)).toEqual(['books', 'book_authors']);
	});

	it('requires every token and also searches descriptions', () => {
		expect(rankItems(items, 'struct sma').map((i) => i.label)).toEqual(['Structure']);
		expect(rankItems(items, 'books zzz')).toEqual([]);
	});

	it('breaks ties by kind and keeps order for empty queries', () => {
		const tied = [item('x', 'tab'), item('x', 'database'), item('x', 'table')];
		expect(rankItems(tied, 'x').map((i) => i.kind)).toEqual(['database', 'table', 'tab']);
		expect(rankItems(items, '').map((i) => i.label)).toEqual(items.map((i) => i.label));
		expect(rankItems(items, '', 2)).toHaveLength(2);
	});
});
