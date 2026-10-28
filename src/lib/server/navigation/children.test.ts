import { describe, expect, it } from 'vitest';
import { getDbChildren } from './children';
import { toNavConfig } from './config';
import { configSchema } from '../config/schema';

const dbi = {
	listTables: async () => [
		{ name: 'b', type: 'BASE TABLE' },
		{ name: 'v', type: 'VIEW' }
	],
	listRoutines: async () => [
		{ name: 'p', type: 'PROCEDURE' },
		{ name: 'f', type: 'FUNCTION' }
	],
	listEvents: async () => [{ name: 'e' }]
} as never;

describe('getDbChildren', () => {
	it('groups the metadata', async () => {
		expect(await getDbChildren(dbi, 'x')).toEqual({
			db: 'x',
			tables: ['b'],
			views: ['v'],
			procedures: ['p'],
			functions: ['f'],
			events: ['e']
		});
	});
});

describe('toNavConfig', () => {
	it('maps phpMyAdmin keys and sanitizes tab names', () => {
		const cfg = configSchema.parse({
			blowfish_secret: 'x'.repeat(32),
			Servers: [{}],
			DefaultTabServer: 'welcome',
			DefaultTabDatabase: 'bogus',
			DefaultTabTable: 'browse',
			NavigationTreeDefaultTabTable: 'structure'
		});
		const nav = toNavConfig(cfg);
		expect(nav.defaultTabServer).toBe('');
		expect(nav.defaultTabDatabase).toBe('structure');
		expect(nav.defaultTabTable).toBe('browse');
		expect(nav.quickTabTable).toBe('structure');
		expect(nav.dbSeparator).toBe('_');
	});
});
