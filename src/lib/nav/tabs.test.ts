import { describe, expect, it } from 'vitest';
import {
	currentTabPath,
	dbTabs,
	findPage,
	isTabActive,
	isValidTab,
	phaseTitle,
	serverTabs,
	tabHref,
	tableTabs
} from './tabs';

const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id);

describe('tab definitions', () => {
	it('server tabs follow Menu.php order; binlog is conditional', () => {
		expect(ids(serverTabs())).toEqual([
			'databases',
			'sql',
			'status',
			'privileges',
			'export',
			'import',
			'settings',
			'replication',
			'variables',
			'charsets',
			'engines',
			'plugins'
		]);
		const withLog = ids(serverTabs({ binlog: true }));
		expect(withLog.indexOf('binlog')).toBe(withLog.indexOf('settings') + 1);
	});

	it('database tabs', () => {
		expect(ids(dbTabs())).toEqual([
			'structure',
			'sql',
			'search',
			'query',
			'export',
			'import',
			'operations',
			'privileges',
			'routines',
			'events',
			'triggers',
			'tracking',
			'designer',
			'central-columns'
		]);
		expect(ids(dbTabs({ tracking: false, centralColumns: false }))).not.toContain('tracking');
	});

	it('table tabs differ for views', () => {
		expect(ids(tableTabs({ isView: false }))).toEqual([
			'browse',
			'structure',
			'sql',
			'search',
			'insert',
			'export',
			'import',
			'privileges',
			'operations',
			'tracking',
			'triggers'
		]);
		expect(ids(tableTabs({ isView: true }))).toEqual([
			'browse',
			'structure',
			'sql',
			'search',
			'export',
			'privileges',
			'operations',
			'tracking'
		]);
	});

	it('tab ids and paths are unique per level and phases are known', () => {
		for (const tabs of [serverTabs({ binlog: true }), dbTabs(), tableTabs({ isView: false })]) {
			expect(new Set(ids(tabs)).size).toBe(tabs.length);
			for (const t of tabs) expect(phaseTitle(t.phase)).toMatch(/^Phase \d/);
		}
	});
});

describe('routing helpers', () => {
	it('validates pages per level', () => {
		expect(isValidTab('server', 'databases')).toBe(true);
		expect(isValidTab('server', 'status/processes')).toBe(true);
		expect(isValidTab('server', 'user-password')).toBe(true);
		expect(isValidTab('server', 'nope')).toBe(false);
		expect(isValidTab('db', 'central-columns')).toBe(true);
		expect(isValidTab('db', 'browse')).toBe(false);
		expect(isValidTab('table', 'zoom-search')).toBe(true);
		expect(isValidTab('table', 'insert')).toBe(true);
		expect(isValidTab('table', 'insert', { isView: true })).toBe(false);
		expect(isValidTab('table', 'import', { isView: true })).toBe(false);
		expect(isValidTab('table', 'browse', { isView: true })).toBe(true);
	});

	it('finds the phase of a page', () => {
		expect(findPage('table', 'browse')?.phase).toBe(4);
		expect(findPage('server', 'status/monitor')?.phase).toBe(9);
		expect(findPage('db', 'x')).toBeUndefined();
	});

	it('highlights a tab for its sub pages', () => {
		const status = serverTabs().find((t) => t.id === 'status')!;
		expect(isTabActive(status, 'status')).toBe(true);
		expect(isTabActive(status, 'status/processes')).toBe(true);
		expect(isTabActive(status, 'statuses')).toBe(false);
		const search = tableTabs({ isView: false }).find((t) => t.id === 'search')!;
		expect(isTabActive(search, 'zoom-search')).toBe(true);
		expect(isTabActive(search, 'browse')).toBe(false);
	});

	it('builds urls with encoded names', () => {
		expect(tabHref('server', {}, 'databases')).toBe('/server/databases');
		expect(tabHref('db', { db: 'my db' }, 'sql')).toBe('/db/my%20db/sql');
		expect(tabHref('table', { db: 'a', table: 'b/c' }, 'browse')).toBe('/db/a/table/b%2Fc/browse');
		expect(currentTabPath('db', { db: 'a' }, '/db/a/structure')).toBe('structure');
		expect(currentTabPath('db', { db: 'a' }, '/db/b/structure')).toBe('');
	});
});
