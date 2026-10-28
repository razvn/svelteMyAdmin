import { describe, expect, it } from 'vitest';
import { connectionRows, type ConnectionsInput } from './status-connections';

const base: ConnectionsInput = {
	uptime: 3600,
	connections: 34,
	maxUsedConnections: 0,
	abortedConnects: 0,
	abortedClients: 0
};

describe('connectionRows', () => {
	it('shows small absolute counts as plain integers (no SI prefix)', () => {
		for (const n of [0, 9, 34]) {
			const rows = connectionRows({ ...base, abortedClients: n, abortedConnects: n });
			const aborted = rows.find((r) => r.name === 'Aborted');
			const failed = rows.find((r) => r.name === 'Failed attempts');
			expect(aborted?.number).toBe(String(n));
			expect(failed?.number).toBe(String(n));
		}
	});

	it('uses grouped integers for the # column', () => {
		const rows = connectionRows({ ...base, connections: 1234, maxUsedConnections: 9 });
		expect(rows.map((r) => r.number)).toEqual(['9', '0', '0', '1,234']);
	});

	it('switches to SI prefixes above 4 digits, like PHP getConnectionsInfo', () => {
		const rows = connectionRows({ ...base, connections: 12345, abortedClients: 23456 });
		const byName = Object.fromEntries(rows.map((r) => [r.name, r.number]));
		expect(byName['Total']).toBe('12 k');
		expect(byName['Aborted']).toBe('23.5 k');
	});

	it('computes per hour and percentage like phpMyAdmin', () => {
		const rows = connectionRows({ ...base, abortedClients: 9, abortedConnects: 0 });
		const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
		expect(byName['Aborted']).toMatchObject({ number: '9', perHour: '9', percentage: '26.47%' });
		expect(byName['Failed attempts']).toMatchObject({
			number: '0',
			perHour: '0',
			percentage: '0%'
		});
		expect(byName['Total']).toMatchObject({ number: '34', perHour: '34', percentage: '100.00%' });
		expect(byName['Max. concurrent connections']).toMatchObject({
			perHour: '---',
			percentage: '---'
		});
	});

	it('scales per hour by the server uptime', () => {
		const rows = connectionRows({ ...base, uptime: 1800, abortedClients: 9 });
		expect(rows.find((r) => r.name === 'Aborted')?.perHour).toBe('18');
	});

	it('shows dashes for percentages without connections', () => {
		const rows = connectionRows({ ...base, connections: 0 });
		expect(rows.find((r) => r.name === 'Aborted')?.percentage).toBe('---');
		expect(rows.find((r) => r.name === 'Failed attempts')?.percentage).toBe('---');
	});
});
