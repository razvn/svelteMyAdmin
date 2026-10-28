import { describe, expect, it } from 'vitest';
import {
	applyHideDb,
	applyOnlyDb,
	filterDatabases,
	hasWildcard,
	likeToRegExp
} from './database-filter';

const all = ['information_schema', 'mysql', 'app_prod', 'app_dev', 'appXdev', 'blog', '100%'];

describe('wildcards', () => {
	it('detects unescaped wildcards', () => {
		expect(hasWildcard('app_%')).toBe(true);
		expect(hasWildcard('app*')).toBe(true);
		expect(hasWildcard('blog')).toBe(false);
		expect(hasWildcard('my\\_db')).toBe(false);
	});
	it('converts LIKE patterns', () => {
		expect(likeToRegExp('app\\_%').test('app_prod')).toBe(true);
		expect(likeToRegExp('app\\_%').test('appXprod')).toBe(false);
		expect(likeToRegExp('app_dev').test('appXdev')).toBe(true);
		expect(likeToRegExp('a.b*').test('a.bc')).toBe(true);
		expect(likeToRegExp('a.b*').test('aXbc')).toBe(false);
	});
});

describe('applyOnlyDb', () => {
	it('is a no-op when unset', () => {
		expect(applyOnlyDb(all, '')).toBe(all);
		expect(applyOnlyDb(all, [])).toBe(all);
	});
	it('keeps literal names even when not listed', () => {
		expect(applyOnlyDb(all, ['blog', 'ghost'])).toEqual(['blog', 'ghost']);
		expect(applyOnlyDb(all, 'blog')).toEqual(['blog']);
	});
	it('expands % / _ / * patterns', () => {
		expect(applyOnlyDb(all, 'app\\_%')).toEqual(['app_prod', 'app_dev']);
		expect(applyOnlyDb(all, ['app_%'])).toEqual(['app_prod', 'app_dev', 'appXdev']);
		expect(applyOnlyDb(all, ['app*', 'blog'])).toEqual(['app_prod', 'app_dev', 'appXdev', 'blog']);
	});
	it('unescapes literal wildcards and removes duplicates', () => {
		expect(applyOnlyDb(all, ['100\\%'])).toEqual(['100%']);
		expect(applyOnlyDb(all, ['app_%', 'app_prod'])).toEqual(['app_prod', 'app_dev', 'appXdev']);
	});
});

describe('applyHideDb', () => {
	it('hides matches of the regexp', () => {
		expect(applyHideDb(all, '^(information_schema|mysql)$')).toEqual([
			'app_prod',
			'app_dev',
			'appXdev',
			'blog',
			'100%'
		]);
		expect(applyHideDb(all, '^app')).toEqual(['information_schema', 'mysql', 'blog', '100%']);
	});
	it('ignores empty or invalid expressions', () => {
		expect(applyHideDb(all, '')).toBe(all);
		expect(applyHideDb(all, '(')).toBe(all);
	});
});

describe('filterDatabases', () => {
	it('applies only_db then hide_db', () => {
		expect(filterDatabases(all, { only_db: 'app_%', hide_db: 'dev$' })).toEqual(['app_prod']);
	});
});
