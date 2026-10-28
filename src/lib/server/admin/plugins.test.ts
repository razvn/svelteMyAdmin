import { describe, expect, it } from 'vitest';
import { groupPluginsByType, pluginTypeAnchor, type PluginRow } from './plugins.ts';

function plugin(name: string, type: string, status = 'ACTIVE'): PluginRow {
	return { name, version: '1.0', status, type, author: '', description: '', license: 'GPL' };
}

describe('groupPluginsByType', () => {
	it('groups by type, sorted by type, keeping plugin order', () => {
		const groups = groupPluginsByType([
			plugin('mysql_native_password', 'AUTHENTICATION'),
			plugin('InnoDB', 'STORAGE ENGINE'),
			plugin('caching_sha2_password', 'AUTHENTICATION'),
			plugin('keyring_file', 'KEYRING')
		]);
		expect(groups.map((g) => g.type)).toEqual(['AUTHENTICATION', 'KEYRING', 'STORAGE ENGINE']);
		expect(groups[0].plugins.map((p) => p.name)).toEqual([
			'mysql_native_password',
			'caching_sha2_password'
		]);
		expect(groups[2].anchor).toBe('plugins-storageengine');
	});

	it('returns no groups for no plugins', () => {
		expect(groupPluginsByType([])).toEqual([]);
	});
});

describe('pluginTypeAnchor', () => {
	it('keeps only lower-case letters, like the PHP template anchors', () => {
		expect(pluginTypeAnchor('INFORMATION SCHEMA')).toBe('plugins-informationschema');
		expect(pluginTypeAnchor('Audit_Log')).toBe('plugins-auditlog');
	});
});
