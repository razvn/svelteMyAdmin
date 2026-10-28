import { describe, expect, it } from 'vitest';
import { activeStatusSubTab, STATUS_SUB_TABS } from './status-tabs';

describe('status sub tabs', () => {
	it('lists the six phpMyAdmin sub pages', () => {
		expect(STATUS_SUB_TABS.map((t) => t.label)).toEqual([
			'Server',
			'Processes',
			'Query statistics',
			'All status variables',
			'Monitor',
			'Advisor'
		]);
	});
	it('detects the active sub tab', () => {
		expect(activeStatusSubTab('/server/status')).toBe('server');
		expect(activeStatusSubTab('/server/status/')).toBe('server');
		expect(activeStatusSubTab('/server/status/processes')).toBe('processes');
		expect(activeStatusSubTab('/server/status/variables')).toBe('variables');
		expect(activeStatusSubTab('/server/status/unknown')).toBe('server');
	});
});
