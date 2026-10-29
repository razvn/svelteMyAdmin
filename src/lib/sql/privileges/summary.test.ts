import { describe, expect, it } from 'vitest';
import { allPrivilegeNames, summarizePrivileges } from './index.ts';

const my84 = { isMariaDB: false, version: 80413 };
const ma114 = { isMariaDB: true, version: 110413 };

describe('summarizePrivileges', () => {
	it('USAGE for nothing', () => {
		expect(summarizePrivileges([], 'global', my84)).toEqual({
			kind: 'usage',
			items: ['USAGE'],
			dynamic: []
		});
	});

	it('ALL PRIVILEGES when every static privilege is there', () => {
		expect(summarizePrivileges(allPrivilegeNames('global', ma114), 'global', ma114).items).toEqual([
			'ALL PRIVILEGES'
		]);
		const s = summarizePrivileges(
			[...allPrivilegeNames('global', my84), 'SYSTEM_USER', 'ROLE_ADMIN'],
			'global',
			my84
		);
		expect(s).toEqual({
			kind: 'all',
			items: ['ALL PRIVILEGES'],
			dynamic: ['SYSTEM_USER', 'ROLE_ADMIN']
		});
		expect(summarizePrivileges(allPrivilegeNames('database', my84), 'database', my84).kind).toBe(
			'all'
		);
	});

	it('lists a partial set and splits off dynamic privileges', () => {
		expect(summarizePrivileges(['SELECT', 'INSERT'], 'global', my84)).toEqual({
			kind: 'list',
			items: ['SELECT', 'INSERT'],
			dynamic: []
		});
		expect(summarizePrivileges(['SELECT', 'BACKUP_ADMIN'], 'global', my84)).toEqual({
			kind: 'list',
			items: ['SELECT'],
			dynamic: ['BACKUP_ADMIN']
		});
		expect(summarizePrivileges(['BACKUP_ADMIN'], 'global', my84).kind).toBe('list');
	});
});
