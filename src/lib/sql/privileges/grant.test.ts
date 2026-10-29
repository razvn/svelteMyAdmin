import { describe, expect, it } from 'vitest';
import {
	buildColumnPrivilegeChanges,
	buildCreateRole,
	buildDatabaseGrants,
	buildDropRole,
	buildGrant,
	buildGrantRole,
	buildPrivilegeChanges,
	buildRevoke,
	buildRevokeAll,
	buildRevokeGrantOption,
	buildRevokeRole,
	buildSetDefaultRole,
	buildShowGrants,
	diffPrivileges,
	escapeWildcards,
	formatTarget,
	isWildcardDb,
	unescapeWildcards
} from './index.ts';

const acc = { user: 'bob', host: 'localhost' };
const ma114 = { isMariaDB: true, version: 110413 };
const my84 = { isMariaDB: false, version: 80413 };

describe('targets', () => {
	it('formats every scope', () => {
		expect(formatTarget({ scope: 'global' })).toBe('*.*');
		expect(formatTarget({ scope: 'database', db: 'shop' })).toBe('`shop`.*');
		expect(formatTarget({ scope: 'database', db: 'my\\_app\\_%' })).toBe('`my\\_app\\_%`.*');
		expect(formatTarget({ scope: 'table', db: 'sh`op', table: 'or`ders' })).toBe(
			'`sh``op`.`or``ders`'
		);
		expect(formatTarget({ scope: 'routine', db: 'shop', routine: 'p1', type: 'PROCEDURE' })).toBe(
			'PROCEDURE `shop`.`p1`'
		);
	});

	it('unescapes wildcards below the database level, as phpMyAdmin does', () => {
		expect(formatTarget({ scope: 'table', db: 'my\\_db', table: 't' })).toBe('`my_db`.`t`');
		expect(formatTarget({ scope: 'routine', db: 'my\\_db', routine: 'f', type: 'FUNCTION' })).toBe(
			'FUNCTION `my_db`.`f`'
		);
	});

	it('escapes / detects wildcards', () => {
		expect(escapeWildcards('a_b%c')).toBe('a\\_b\\%c');
		expect(unescapeWildcards('a\\_b\\%c')).toBe('a_b%c');
		expect(isWildcardDb('a_b')).toBe(true);
		expect(isWildcardDb('a\\_b')).toBe(false);
		expect(isWildcardDb('plain')).toBe(false);
	});
});

describe('GRANT / REVOKE', () => {
	it('grants a set at global, database, table and routine level', () => {
		expect(
			buildGrant({ account: acc, target: { scope: 'global' }, privileges: ['SELECT', 'INSERT'] })
				.sql
		).toBe("GRANT SELECT, INSERT ON *.* TO 'bob'@'localhost'");
		expect(
			buildGrant({
				account: acc,
				target: { scope: 'database', db: 'shop' },
				privileges: ['SELECT'],
				grantOption: true
			}).sql
		).toBe("GRANT SELECT ON `shop`.* TO 'bob'@'localhost' WITH GRANT OPTION");
		expect(
			buildGrant({
				account: acc,
				target: { scope: 'table', db: 'shop', table: 'orders' },
				privileges: ['UPDATE', 'DELETE']
			}).sql
		).toBe("GRANT UPDATE, DELETE ON `shop`.`orders` TO 'bob'@'localhost'");
		expect(
			buildGrant({
				account: acc,
				target: { scope: 'routine', db: 'shop', routine: 'p', type: 'PROCEDURE' },
				privileges: ['EXECUTE']
			}).sql
		).toBe("GRANT EXECUTE ON PROCEDURE `shop`.`p` TO 'bob'@'localhost'");
	});

	it('grants USAGE for an empty set and ALL PRIVILEGES on request', () => {
		expect(buildGrant({ account: acc, target: { scope: 'global' }, privileges: [] }).sql).toBe(
			"GRANT USAGE ON *.* TO 'bob'@'localhost'"
		);
		expect(
			buildGrant({
				account: acc,
				target: { scope: 'database', db: 'x' },
				privileges: [],
				all: true
			}).sql
		).toBe("GRANT ALL PRIVILEGES ON `x`.* TO 'bob'@'localhost'");
	});

	it('grants column privileges', () => {
		expect(
			buildGrant({
				account: acc,
				target: { scope: 'table', db: 'd', table: 't' },
				privileges: [
					{ name: 'SELECT', columns: ['a', 'b`c'] },
					{ name: 'INSERT', columns: ['a'] }
				]
			}).sql
		).toBe("GRANT SELECT (`a`, `b``c`), INSERT (`a`) ON `d`.`t` TO 'bob'@'localhost'");
		expect(() =>
			buildGrant({
				account: acc,
				target: { scope: 'table', db: 'd', table: 't' },
				privileges: [{ name: 'SELECT', columns: [] }]
			})
		).toThrow();
	});

	it('keeps dynamic and multi-word privileges global only', () => {
		expect(
			buildGrant({
				account: acc,
				target: { scope: 'global' },
				privileges: ['SELECT', 'SYSTEM_VARIABLES_ADMIN', 'CREATE TEMPORARY TABLES']
			}).sql
		).toBe(
			"GRANT SELECT, SYSTEM_VARIABLES_ADMIN, CREATE TEMPORARY TABLES ON *.* TO 'bob'@'localhost'"
		);
		expect(() =>
			buildGrant({
				account: acc,
				target: { scope: 'database', db: 'd' },
				privileges: ['SYSTEM_VARIABLES_ADMIN']
			})
		).toThrow(/only be granted globally/);
		expect(() =>
			buildGrant({ account: acc, target: { scope: 'database', db: 'd' }, privileges: ['FILE'] })
		).toThrow(/cannot be granted/);
		expect(() =>
			buildGrant({ account: acc, target: { scope: 'global' }, privileges: ['SELECT; DROP USER x'] })
		).toThrow(/Invalid privilege/);
	});

	it('revokes', () => {
		expect(
			buildRevoke({ account: acc, target: { scope: 'global' }, privileges: ['FILE', 'SUPER'] }).sql
		).toBe("REVOKE FILE, SUPER ON *.* FROM 'bob'@'localhost'");
		expect(() =>
			buildRevoke({ account: acc, target: { scope: 'global' }, privileges: [] })
		).toThrow();
		expect(buildRevokeGrantOption(acc, { scope: 'database', db: 'd' }).sql).toBe(
			"REVOKE GRANT OPTION ON `d`.* FROM 'bob'@'localhost'"
		);
		expect(buildRevokeAll(acc, { scope: 'table', db: 'd', table: 't' }).map((s) => s.sql)).toEqual([
			"REVOKE ALL PRIVILEGES ON `d`.`t` FROM 'bob'@'localhost'",
			"REVOKE GRANT OPTION ON `d`.`t` FROM 'bob'@'localhost'"
		]);
	});

	it('quotes hostile account names', () => {
		expect(
			buildGrant({
				account: { user: "a'", host: "%'" },
				target: { scope: 'global' },
				privileges: ['SELECT']
			}).sql
		).toBe("GRANT SELECT ON *.* TO 'a\\''@'%\\''");
	});
});

describe('privilege diffs', () => {
	it('diffs sets', () => {
		expect(diffPrivileges(['SELECT', 'INSERT'], ['INSERT', 'UPDATE'])).toEqual({
			grant: ['UPDATE'],
			revoke: ['SELECT']
		});
	});

	const base = { account: acc, target: { scope: 'global' } as const };

	it('adds privileges', () => {
		expect(
			buildPrivilegeChanges({
				...base,
				current: ['SELECT', 'INSERT'],
				desired: ['SELECT', 'INSERT', 'UPDATE'],
				currentGrantOption: false,
				grantOption: false
			}).map((s) => s.sql)
		).toEqual(["GRANT UPDATE ON *.* TO 'bob'@'localhost'"]);
	});

	it('removes privileges and the grant option', () => {
		expect(
			buildPrivilegeChanges({
				...base,
				current: ['SELECT', 'INSERT'],
				desired: ['SELECT'],
				currentGrantOption: true,
				grantOption: false
			}).map((s) => s.sql)
		).toEqual([
			"REVOKE INSERT ON *.* FROM 'bob'@'localhost'",
			"REVOKE GRANT OPTION ON *.* FROM 'bob'@'localhost'"
		]);
	});

	it('adds only the grant option', () => {
		expect(
			buildPrivilegeChanges({
				...base,
				current: ['SELECT'],
				desired: ['SELECT'],
				currentGrantOption: false,
				grantOption: true
			}).map((s) => s.sql)
		).toEqual(["GRANT USAGE ON *.* TO 'bob'@'localhost' WITH GRANT OPTION"]);
	});

	it('carries the grant option when privileges are added while it is wanted', () => {
		expect(
			buildPrivilegeChanges({
				...base,
				current: ['SELECT'],
				desired: ['SELECT', 'SYSTEM_VARIABLES_ADMIN'],
				currentGrantOption: true,
				grantOption: true
			}).map((s) => s.sql)
		).toEqual(["GRANT SYSTEM_VARIABLES_ADMIN ON *.* TO 'bob'@'localhost' WITH GRANT OPTION"]);
	});

	it('does nothing when nothing changed', () => {
		expect(
			buildPrivilegeChanges({
				...base,
				current: ['SELECT'],
				desired: ['SELECT'],
				currentGrantOption: true,
				grantOption: true
			})
		).toEqual([]);
	});

	it('revokes everything', () => {
		expect(
			buildPrivilegeChanges({
				account: acc,
				target: { scope: 'database', db: 'd' },
				current: ['SELECT', 'INSERT'],
				desired: [],
				currentGrantOption: false,
				grantOption: false
			}).map((s) => s.sql)
		).toEqual(["REVOKE SELECT, INSERT ON `d`.* FROM 'bob'@'localhost'"]);
	});

	it('diffs column privileges', () => {
		expect(
			buildColumnPrivilegeChanges(
				acc,
				{ scope: 'table', db: 'd', table: 't' },
				{ SELECT: ['a', 'b'], UPDATE: ['a'] },
				{ SELECT: ['b', 'c'], INSERT: ['a'] }
			).map((s) => s.sql)
		).toEqual([
			"REVOKE SELECT (`a`), UPDATE (`a`) ON `d`.`t` FROM 'bob'@'localhost'",
			"GRANT SELECT (`c`), INSERT (`a`) ON `d`.`t` TO 'bob'@'localhost'"
		]);
	});
});

describe('Database for user account', () => {
	it('creates the same-name database and escapes wildcards in the user name', () => {
		expect(
			buildDatabaseGrants({ user: 'app_user', host: '%' }, { createSameName: true }).map(
				(s) => s.sql
			)
		).toEqual([
			'CREATE DATABASE IF NOT EXISTS `app_user`',
			"GRANT ALL PRIVILEGES ON `app\\_user`.* TO 'app_user'@'%'"
		]);
	});

	it('grants the wildcard name and a given database', () => {
		expect(
			buildDatabaseGrants({ user: 'u_1', host: 'h' }, { wildcard: true, database: 'shop' }).map(
				(s) => s.sql
			)
		).toEqual([
			"GRANT ALL PRIVILEGES ON `u\\_1\\_%`.* TO 'u_1'@'h'",
			"GRANT ALL PRIVILEGES ON `shop`.* TO 'u_1'@'h'"
		]);
		expect(buildDatabaseGrants(acc, {})).toEqual([]);
	});
});

describe('roles', () => {
	it('MariaDB uses identifiers, MySQL accounts', () => {
		expect(buildCreateRole(ma114, 'r').sql).toBe('CREATE ROLE `r`');
		expect(buildCreateRole(my84, 'r').sql).toBe("CREATE ROLE 'r'@'%'");
		expect(buildDropRole(ma114, 'r').sql).toBe('DROP ROLE `r`');
		expect(buildGrantRole(ma114, 'r', acc, true).sql).toBe(
			"GRANT `r` TO 'bob'@'localhost' WITH ADMIN OPTION"
		);
		expect(buildGrantRole(my84, 'r', acc).sql).toBe("GRANT 'r'@'%' TO 'bob'@'localhost'");
		expect(buildRevokeRole(my84, 'r', acc).sql).toBe("REVOKE 'r'@'%' FROM 'bob'@'localhost'");
		expect(buildSetDefaultRole(ma114, ['r'], acc).sql).toBe(
			"SET DEFAULT ROLE `r` FOR 'bob'@'localhost'"
		);
		expect(buildSetDefaultRole(my84, ['r', 's'], acc).sql).toBe(
			"SET DEFAULT ROLE 'r'@'%', 's'@'%' TO 'bob'@'localhost'"
		);
		expect(buildSetDefaultRole(my84, 'NONE', acc).sql).toBe(
			"SET DEFAULT ROLE NONE TO 'bob'@'localhost'"
		);
		expect(() => buildSetDefaultRole(ma114, ['a', 'b'], acc)).toThrow();
	});

	it('shows grants', () => {
		expect(buildShowGrants(acc)).toBe("SHOW GRANTS FOR 'bob'@'localhost'");
	});
});
