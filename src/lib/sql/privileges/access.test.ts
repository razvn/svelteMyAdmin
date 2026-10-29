import { describe, expect, it } from 'vitest';
import { accessEntries, likeMatch } from './access.ts';
import type { CopyGrants } from './copy-user.ts';

describe('likeMatch', () => {
	it('handles wildcards and escapes', () => {
		expect(likeMatch('tmp\\_%', 'tmp_a')).toBe(true);
		expect(likeMatch('tmp\\_%', 'tmpxa')).toBe(false);
		expect(likeMatch('tmp_%', 'tmpxa')).toBe(true);
		expect(likeMatch('my\\_db', 'my_db')).toBe(true);
		expect(likeMatch('my\\_db', 'myxdb')).toBe(false);
	});
});

describe('accessEntries', () => {
	const grants: CopyGrants = {
		global: { privileges: ['SELECT'], grantOption: false, grantable: [] },
		databases: [
			{ db: 'my\\_db', privileges: ['INSERT'], grantOption: false },
			{ db: 'my%', privileges: ['UPDATE'], grantOption: true },
			{ db: 'other', privileges: ['DELETE'], grantOption: false }
		],
		tables: [
			{
				db: 'my_db',
				table: 't',
				privileges: ['DROP'],
				columns: [{ privilege: 'SELECT', columns: ['a'] }],
				grantOption: false
			}
		],
		routines: [
			{ db: 'my_db', routine: 'p', type: 'PROCEDURE', privileges: ['EXECUTE'], grantOption: false }
		],
		proxies: [],
		roles: []
	};
	it('lists global, database, wildcard, table and routine access', () => {
		const e = accessEntries(grants, 'my_db', 't');
		expect(e.map((x) => x.type)).toEqual([
			'global',
			'database-specific',
			'wildcard',
			'table-specific',
			'routine'
		]);
		expect(e[3].privileges).toEqual(['DROP', 'SELECT (a)']);
	});
	it('omits table entries for the database view', () => {
		expect(accessEntries(grants, 'my_db').some((x) => x.type === 'table-specific')).toBe(false);
	});
});
