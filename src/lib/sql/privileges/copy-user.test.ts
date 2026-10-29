import { describe, expect, it } from 'vitest';
import { planChangeLogin, type CopyGrants } from './copy-user.ts';

const my = { isMariaDB: false, version: 80404 };
const ma = { isMariaDB: true, version: 110413 };
const from = { user: 'old', host: '%' };
const to = { user: 'new', host: 'localhost' };
const grants: CopyGrants = {
	global: { privileges: ['SELECT'], grantOption: false, grantable: [] },
	databases: [{ db: 'app\\_%', privileges: ['SELECT', 'INSERT'], grantOption: true }],
	tables: [
		{
			db: 'd',
			table: 't',
			privileges: ['DELETE'],
			columns: [{ privilege: 'SELECT', columns: ['a', 'b'] }],
			grantOption: false
		}
	],
	routines: [
		{ db: 'd', routine: 'p', type: 'PROCEDURE', privileges: ['EXECUTE'], grantOption: false }
	],
	proxies: [],
	roles: [{ role: 'r1', host: '%', adminOption: true }]
};
const src = { grants, plugin: 'caching_sha2_password', passwordHash: '$A$005$x' };

describe('planChangeLogin', () => {
	it('rejects an unchanged account', () => {
		expect(() => planChangeLogin(my, from, from, 4, src)).toThrow(/didn't change/);
	});
	it('mode 4 copies every level and keeps the old account', () => {
		const p = planChangeLogin(my, from, to, 4, src);
		const sql = p.copy.map((s) => s.sql);
		expect(sql[0]).toBe(
			"CREATE USER 'new'@'localhost' IDENTIFIED WITH caching_sha2_password AS '$A$005$x'"
		);
		expect(sql).toContain("GRANT SELECT ON *.* TO 'new'@'localhost'");
		expect(sql).toContain(
			"GRANT SELECT, INSERT ON `app\\_%`.* TO 'new'@'localhost' WITH GRANT OPTION"
		);
		expect(sql).toContain("GRANT DELETE, SELECT (`a`, `b`) ON `d`.`t` TO 'new'@'localhost'");
		expect(sql).toContain("GRANT EXECUTE ON PROCEDURE `d`.`p` TO 'new'@'localhost'");
		expect(sql).toContain("GRANT 'r1'@'%' TO 'new'@'localhost' WITH ADMIN OPTION");
		expect(p.cleanup).toEqual([]);
	});
	it('masks the hash in display', () => {
		const p = planChangeLogin(my, from, to, 4, src);
		expect(p.copy[0].display).toContain("AS '***'");
	});
	it('mode 2 revokes everything then drops', () => {
		const p = planChangeLogin(ma, from, to, 2, {
			...src,
			plugin: 'mysql_native_password',
			passwordHash: '*ABC'
		});
		expect(p.copy[0].sql).toBe("CREATE USER 'new'@'localhost' IDENTIFIED BY PASSWORD '*ABC'");
		const c = p.cleanup.map((s) => s.sql);
		expect(c).toEqual([
			"REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'old'@'%'",
			"DROP USER 'old'@'%'"
		]);
	});
	it('modes 1 and 3 rename', () => {
		expect(planChangeLogin(my, from, to, 1, src).copy[0].sql).toBe(
			"RENAME USER 'old'@'%' TO 'new'@'localhost'"
		);
		expect(planChangeLogin(my, from, to, 3, src).cleanup[0].sql).toBe('FLUSH PRIVILEGES');
	});
});
