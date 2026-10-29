import { describe, expect, it } from 'vitest';
import { dbTabs, serverTabs, tableTabs } from './tabs.ts';
import {
	allTabKeys,
	filterTabs,
	isPathAllowed,
	menuTabs,
	parseTabKey,
	tabIdFromPmaName,
	tabKey
} from './user-groups.ts';

describe('tab key mapping', () => {
	it('uses the phpMyAdmin names where ids differ', () => {
		expect(tabKey('server', 'privileges')).toBe('server_rights');
		expect(tabKey('server', 'variables')).toBe('server_vars');
		expect(tabKey('server', 'charsets')).toBe('server_charset');
		expect(tabKey('server', 'engines')).toBe('server_engine');
		expect(tabKey('db', 'operations')).toBe('db_operation');
		expect(tabKey('db', 'central-columns')).toBe('db_central_columns');
		expect(tabKey('table', 'operations')).toBe('table_operation');
		expect(tabKey('db', 'privileges')).toBe('db_privileges');
		expect(tabKey('table', 'browse')).toBe('table_browse');
	});

	it('maps back', () => {
		expect(tabIdFromPmaName('server', 'rights')).toBe('privileges');
		expect(parseTabKey('db_central_columns')).toEqual({ level: 'db', id: 'central-columns' });
		expect(parseTabKey('table_operation')).toEqual({ level: 'table', id: 'operations' });
		expect(parseTabKey('nonsense')).toBeNull();
		expect(parseTabKey('x_sql')).toBeNull();
	});

	it('round-trips every tab and matches the PHP key list', () => {
		for (const level of ['server', 'db', 'table'] as const) {
			for (const t of menuTabs(level)) expect(parseTabKey(t.key)).toEqual({ level, id: t.id });
		}
		expect(allTabKeys()).toHaveLength(13 + 14 + 11);
		expect(menuTabs('server').map((t) => t.key)).toEqual([
			'server_databases',
			'server_sql',
			'server_status',
			'server_rights',
			'server_export',
			'server_import',
			'server_settings',
			'server_binlog',
			'server_replication',
			'server_vars',
			'server_charset',
			'server_engine',
			'server_plugins'
		]);
	});
});

describe('filterTabs', () => {
	it('returns every tab without denials', () => {
		expect(filterTabs('server', serverTabs(), [])).toEqual(serverTabs());
	});
	it('removes denied tabs of the level only', () => {
		const out = filterTabs('server', serverTabs(), ['server_status', 'db_sql', 'server_vars']);
		expect(out.map((t) => t.id)).not.toContain('status');
		expect(out.map((t) => t.id)).not.toContain('variables');
		expect(out.map((t) => t.id)).toContain('sql');
		expect(filterTabs('db', dbTabs(), ['server_sql']).map((t) => t.id)).toContain('sql');
		expect(filterTabs('db', dbTabs(), ['db_operation']).map((t) => t.id)).not.toContain(
			'operations'
		);
		expect(filterTabs('table', tableTabs({ isView: false }), ['table_browse'])[0].id).toBe(
			'structure'
		);
	});
});

describe('isPathAllowed', () => {
	const denied = ['server_status', 'server_rights', 'table_browse'];
	it('blocks denied tabs, sub pages and aliases', () => {
		expect(isPathAllowed('server', 'status', denied)).toBe(false);
		expect(isPathAllowed('server', 'status/processes', denied)).toBe(false);
		expect(isPathAllowed('server', 'privileges', denied)).toBe(false);
		expect(isPathAllowed('server', 'user-groups', denied)).toBe(false);
		expect(isPathAllowed('table', 'browse', denied)).toBe(false);
	});
	it('allows the rest, unknown paths and no denials', () => {
		expect(isPathAllowed('server', 'databases', denied)).toBe(true);
		expect(isPathAllowed('server', 'user-password', denied)).toBe(true);
		expect(isPathAllowed('db', 'structure', denied)).toBe(true);
		expect(isPathAllowed('server', 'status', [])).toBe(true);
		expect(isPathAllowed('db', 'table/x/browse', denied)).toBe(true);
	});
});
