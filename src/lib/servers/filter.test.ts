import { describe, expect, it } from 'vitest';
import {
	filterServers,
	selectionAfterFilter,
	serverMatches,
	type PickableServer
} from './filter.ts';

const servers: PickableServer[] = [
	{ index: 1, label: 'Local MySQL 8.4', host: '127.0.0.1', port: 33306 },
	{ index: 2, label: 'Local MariaDB 11.4', host: '127.0.0.1', port: 33307 },
	{ index: 3, label: 'review-42', host: 'db-review.internal', port: 3306 },
	{ index: 4, label: 'db-10.0.0.5', host: '10.0.0.5', port: 0 }
];

describe('serverMatches', () => {
	it('matches everything for a blank query', () => {
		expect(serverMatches(servers[0], '')).toBe(true);
		expect(serverMatches(servers[0], '   ')).toBe(true);
	});

	it('matches the label case-insensitively', () => {
		expect(serverMatches(servers[0], 'local mysql')).toBe(true);
		expect(serverMatches(servers[0], 'LOCAL MYSQL')).toBe(true);
		expect(serverMatches(servers[0], 'mariadb')).toBe(false);
	});

	it('ignores surrounding whitespace in the query', () => {
		expect(serverMatches(servers[2], '  REVIEW-42 ')).toBe(true);
	});

	it('matches the host, case-insensitively', () => {
		expect(serverMatches(servers[2], 'INTERNAL')).toBe(true);
		expect(serverMatches(servers[0], '127.0.0.1')).toBe(true);
	});

	it('matches the port', () => {
		expect(serverMatches(servers[1], '33307')).toBe(true);
		expect(serverMatches(servers[1], '33306')).toBe(false);
	});

	it('matches host:port as a whole', () => {
		expect(serverMatches(servers[1], '127.0.0.1:33307')).toBe(true);
		expect(serverMatches(servers[1], '127.0.0.1:33306')).toBe(false);
	});

	it('does not invent a port for servers using the default port', () => {
		const noPort: PickableServer = { index: 5, label: 'staging', host: 'stage.test', port: 0 };
		expect(serverMatches(noPort, '0')).toBe(false);
		expect(serverMatches(noPort, 'stage.test')).toBe(true);
	});

	it('works without host and port (label only)', () => {
		expect(serverMatches({ index: 9, label: 'staging' }, 'stag')).toBe(true);
		expect(serverMatches({ index: 9, label: 'staging' }, 'prod')).toBe(false);
	});
});

describe('filterServers', () => {
	it('returns all servers for a blank query, in order', () => {
		expect(filterServers(servers, '').map((s) => s.index)).toEqual([1, 2, 3, 4]);
	});

	it('keeps the original order of the matches', () => {
		expect(filterServers(servers, '127.0.0.1').map((s) => s.index)).toEqual([1, 2]);
	});

	it('returns an empty list when nothing matches', () => {
		expect(filterServers(servers, 'nope')).toEqual([]);
	});

	it('keeps extra properties of the generic input', () => {
		const withAuth = servers.map((s) => ({ ...s, auth: 'cookie' }));
		expect(filterServers(withAuth, 'review')[0]).toMatchObject({ index: 3, auth: 'cookie' });
	});
});

describe('selectionAfterFilter', () => {
	it('keeps the current selection when it is still listed', () => {
		expect(selectionAfterFilter(filterServers(servers, '127'), 2)).toBe(2);
	});

	it('moves to the first match when the current selection is filtered out', () => {
		expect(selectionAfterFilter(filterServers(servers, 'review'), 1)).toBe(3);
	});

	it('returns undefined when nothing matches', () => {
		expect(selectionAfterFilter([], 1)).toBeUndefined();
	});
});
