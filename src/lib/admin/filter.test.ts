import { describe, expect, it } from 'vitest';
import { matchesFilter } from './filter.ts';

describe('matchesFilter', () => {
	it('matches everything for an empty or blank query', () => {
		expect(matchesFilter('', 'innodb_buffer_pool_size')).toBe(true);
		expect(matchesFilter('   ', 'anything')).toBe(true);
	});

	it('is a case-insensitive substring match', () => {
		expect(matchesFilter('BUFFER', 'innodb_buffer_pool_size')).toBe(true);
		expect(matchesFilter('pool_s', 'innodb_buffer_pool_size')).toBe(true);
		expect(matchesFilter('max', 'innodb_buffer_pool_size')).toBe(false);
	});

	it('trims the query', () => {
		expect(matchesFilter('  key  ', 'key_buffer_size')).toBe(true);
	});

	it('checks every field and ignores missing ones', () => {
		expect(matchesFilter('author', 'name', null, 'Some Author')).toBe(true);
		expect(matchesFilter('nope', 'name', undefined, null)).toBe(false);
	});
});
