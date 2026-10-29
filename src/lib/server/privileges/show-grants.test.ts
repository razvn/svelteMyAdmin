import { describe, expect, it } from 'vitest';
import { allPrivilegeNames } from '#lib/sql/privileges/index.ts';
import { parseGrantTail, parseShowGrants } from './show-grants.ts';

const my84 = { isMariaDB: false, version: 80413 };
const ma114 = { isMariaDB: true, version: 110413 };

describe('SHOW GRANTS on MySQL 8.4', () => {
	it('parses a typical account with every kind of line', () => {
		const g = parseShowGrants(
			[
				'GRANT SELECT, INSERT, CREATE TEMPORARY TABLES, REPLICATION CLIENT ON *.* TO `tmp_t7a_probe`@`h%` WITH GRANT OPTION',
				'GRANT ROLE_ADMIN,SYSTEM_VARIABLES_ADMIN ON *.* TO `tmp_t7a_probe`@`h%`',
				'GRANT ALL PRIVILEGES ON `tmp\\_t7a\\_probe`.* TO `tmp_t7a_probe`@`h%`',
				'GRANT SELECT ON `tmp_t7a_%`.* TO `tmp_t7a_probe`@`h%`',
				'GRANT SELECT (`a`, `b`), INSERT (`a`), UPDATE, DELETE, DROP ON `tmp_t7a_probe`.`t` TO `tmp_t7a_probe`@`h%` WITH GRANT OPTION',
				'GRANT EXECUTE, ALTER ROUTINE ON PROCEDURE `tmp_t7a_probe`.`p` TO `tmp_t7a_probe`@`h%`',
				'GRANT EXECUTE ON FUNCTION `tmp_t7a_probe`.`f` TO `tmp_t7a_probe`@`h%` WITH GRANT OPTION',
				'GRANT `tmp_t7a_role`@`%` TO `tmp_t7a_probe`@`h%` WITH ADMIN OPTION'
			],
			my84
		);
		expect(g.unparsed).toEqual([]);
		expect(g.global.privileges).toEqual([
			'SELECT',
			'INSERT',
			'CREATE TEMPORARY TABLES',
			'REPLICATION CLIENT',
			'ROLE_ADMIN',
			'SYSTEM_VARIABLES_ADMIN'
		]);
		expect(g.global.grantOption).toBe(true);
		expect(g.global.grantable).toEqual([
			'SELECT',
			'INSERT',
			'CREATE TEMPORARY TABLES',
			'REPLICATION CLIENT'
		]);
		expect(g.databases).toEqual([
			{
				db: 'tmp\\_t7a\\_probe',
				privileges: allPrivilegeNames('database', my84),
				grantOption: false
			},
			{ db: 'tmp_t7a_%', privileges: ['SELECT'], grantOption: false }
		]);
		expect(g.tables).toEqual([
			{
				db: 'tmp_t7a_probe',
				table: 't',
				privileges: ['UPDATE', 'DELETE', 'DROP'],
				columns: [
					{ privilege: 'SELECT', columns: ['a', 'b'] },
					{ privilege: 'INSERT', columns: ['a'] }
				],
				grantOption: true
			}
		]);
		expect(g.routines).toEqual([
			{
				db: 'tmp_t7a_probe',
				routine: 'p',
				type: 'PROCEDURE',
				privileges: ['EXECUTE', 'ALTER ROUTINE'],
				grantOption: false
			},
			{
				db: 'tmp_t7a_probe',
				routine: 'f',
				type: 'FUNCTION',
				privileges: ['EXECUTE'],
				grantOption: true
			}
		]);
		expect(g.roles).toEqual([{ role: 'tmp_t7a_role', host: '%', adminOption: true }]);
	});

	it('parses USAGE accounts and the root dynamic privilege line', () => {
		const g = parseShowGrants(
			[
				'GRANT USAGE ON *.* TO `pma`@`%`',
				'GRANT SELECT, INSERT, UPDATE, DELETE, ALTER ON `phpmyadmin`.* TO `pma`@`%`'
			],
			my84
		);
		expect(g.global).toEqual({ privileges: [], grantOption: false, grantable: [] });
		expect(g.databases[0]).toEqual({
			db: 'phpmyadmin',
			privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALTER'],
			grantOption: false
		});
		const root = parseShowGrants(
			[
				'GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, RELOAD, SHUTDOWN, PROCESS, FILE, REFERENCES, INDEX, ALTER, SHOW DATABASES, SUPER, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, REPLICATION SLAVE, REPLICATION CLIENT, CREATE VIEW, SHOW VIEW, CREATE ROUTINE, ALTER ROUTINE, CREATE USER, EVENT, TRIGGER, CREATE TABLESPACE, CREATE ROLE, DROP ROLE ON *.* TO `root`@`%` WITH GRANT OPTION',
				'GRANT ALLOW_NONEXISTENT_DEFINER,APPLICATION_PASSWORD_ADMIN,AUDIT_ABORT_EXEMPT,SYSTEM_USER ON *.* TO `root`@`%` WITH GRANT OPTION'
			],
			my84
		);
		expect(root.global.privileges).toContain('CREATE ROLE');
		expect(root.global.privileges).toContain('SYSTEM_USER');
		expect(root.global.privileges).toHaveLength(30 + 4);
		expect(root.global.grantOption).toBe(true);
		expect(root.global.grantable).toContain('SYSTEM_USER');
	});

	it('does not set the grant option for a dynamic-only WITH GRANT OPTION line', () => {
		const g = parseShowGrants(
			['GRANT SELECT ON *.* TO `u`@`%`', 'GRANT SYSTEM_USER ON *.* TO `u`@`%` WITH GRANT OPTION'],
			my84
		);
		expect(g.global.grantOption).toBe(false);
		expect(g.global.grantable).toEqual(['SYSTEM_USER']);
	});

	it('keeps partial revokes and proxy grants', () => {
		const g = parseShowGrants(
			[
				'GRANT SELECT, INSERT ON *.* TO `u`@`%`',
				'REVOKE INSERT ON `mysql`.* FROM `u`@`%`',
				"GRANT PROXY ON ''@'' TO 'root'@'localhost' WITH GRANT OPTION",
				'GRANT PROXY ON `admin`@`%` TO `u`@`%`'
			],
			my84
		);
		expect(g.partialRevokes).toEqual(['REVOKE INSERT ON `mysql`.* FROM `u`@`%`']);
		expect(g.proxies).toEqual([
			{ proxied: { user: '', host: '' }, grantOption: true },
			{ proxied: { user: 'admin', host: '%' }, grantOption: false }
		]);
		expect(g.unparsed).toEqual([]);
	});

	it('handles several roles on one line and old single-quoted output', () => {
		const g = parseShowGrants(
			[
				"GRANT 'r1'@'%','r2'@'localhost' TO 'u'@'%'",
				"GRANT SELECT ON `db`.* TO 'u'@'%' IDENTIFIED BY PASSWORD '*ABC'"
			],
			my84
		);
		expect(g.roles).toEqual([
			{ role: 'r1', host: '%', adminOption: false },
			{ role: 'r2', host: 'localhost', adminOption: false }
		]);
		expect(g.databases[0].privileges).toEqual(['SELECT']);
	});

	it('survives names containing keywords, quotes and dots', () => {
		const g = parseShowGrants(
			[
				'GRANT SELECT (`a ON b`, `c``d`) ON `x TO y`.`t.u` TO `we``ird`@`h` WITH GRANT OPTION',
				'GRANT INSERT ON `d.b`.* TO `a ON b`@`1.2.3.%`'
			],
			my84
		);
		expect(g.tables).toEqual([
			{
				db: 'x TO y',
				table: 't.u',
				privileges: [],
				columns: [{ privilege: 'SELECT', columns: ['a ON b', 'c`d'] }],
				grantOption: true
			}
		]);
		expect(g.databases).toEqual([{ db: 'd.b', privileges: ['INSERT'], grantOption: false }]);
	});

	it('reports lines it cannot parse', () => {
		const g = parseShowGrants(['FOO BAR', 'GRANT SELECT'], my84);
		expect(g.unparsed).toEqual(['FOO BAR', 'GRANT SELECT']);
	});
});

describe('SHOW GRANTS on MariaDB 11.4', () => {
	it('parses the global line with its tail', () => {
		const g = parseShowGrants(
			[
				"GRANT SELECT, INSERT, CREATE TEMPORARY TABLES, BINLOG MONITOR, BINLOG ADMIN, SLAVE MONITOR ON *.* TO `tmp_t7a_probe`@`h%` IDENTIFIED BY PASSWORD '*B69027D44F6E5EDC07F1AEAD1477967B16F28227' REQUIRE SSL WITH GRANT OPTION MAX_QUERIES_PER_HOUR 5",
				'GRANT ALL PRIVILEGES ON `tmp\\_t7a\\_probe`.* TO `tmp_t7a_probe`@`h%`',
				'GRANT PROXY ON `root`@`localhost` TO `tmp_t7a_probe`@`h%`',
				'GRANT `tmp_t7a_role` TO `tmp_t7a_probe`@`h%` WITH ADMIN OPTION'
			],
			ma114
		);
		expect(g.unparsed).toEqual([]);
		expect(g.global.privileges).toEqual([
			'SELECT',
			'INSERT',
			'CREATE TEMPORARY TABLES',
			'BINLOG MONITOR',
			'BINLOG ADMIN',
			'SLAVE MONITOR'
		]);
		expect(g.global.grantOption).toBe(true);
		expect(g.tail).toEqual({
			passwordHash: '*B69027D44F6E5EDC07F1AEAD1477967B16F28227',
			ssl: { type: 'ANY' },
			limits: { maxQuestions: 5 }
		});
		expect(g.databases[0].privileges).toEqual(allPrivilegeNames('database', ma114));
		expect(g.databases[0].privileges).toContain('DELETE HISTORY');
		expect(g.proxies).toEqual([
			{ proxied: { user: 'root', host: 'localhost' }, grantOption: false }
		]);
		expect(g.roles).toEqual([{ role: 'tmp_t7a_role', host: null, adminOption: true }]);
	});

	it('expands ALL PRIVILEGES globally and maps REPLICATION CLIENT', () => {
		const g = parseShowGrants(
			[
				"GRANT ALL PRIVILEGES ON *.* TO `root`@`%` IDENTIFIED BY PASSWORD '*81F5E21E35407D884A6CD4A731AEBFB6AF209E1B' WITH GRANT OPTION",
				'GRANT PROXY ON ``@`%` TO `root`@`%` WITH GRANT OPTION'
			],
			ma114
		);
		expect(g.global.privileges).toEqual(allPrivilegeNames('global', ma114));
		expect(g.global.privileges).toContain('BINLOG MONITOR');
		expect(g.global.privileges).not.toContain('REPLICATION CLIENT');
		expect(g.proxies).toEqual([{ proxied: { user: '', host: '%' }, grantOption: true }]);
		expect(
			parseShowGrants(['GRANT REPLICATION CLIENT ON *.* TO `u`@`%`'], ma114).global.privileges
		).toEqual(['BINLOG MONITOR']);
	});

	it('parses IDENTIFIED VIA plugins and REQUIRE parts', () => {
		const g = parseShowGrants(
			[
				"GRANT USAGE ON *.* TO `ed`@`%` IDENTIFIED VIA ed25519 USING 'xyzHASH' REQUIRE CIPHER 'AES256-SHA' AND ISSUER '/C=US' AND SUBJECT '/CN=a b' WITH MAX_USER_CONNECTIONS 2"
			],
			ma114
		);
		expect(g.tail.plugins).toEqual(['ed25519']);
		expect(g.tail.pluginArgument).toBe('xyzHASH');
		expect(g.tail.ssl).toEqual({
			type: 'SPECIFIED',
			cipher: 'AES256-SHA',
			issuer: '/C=US',
			subject: '/CN=a b'
		});
		expect(g.tail.limits).toEqual({ maxUserConnections: 2 });
		expect(g.global.privileges).toEqual([]);
	});

	it('parses a role with USAGE and multiple VIA plugins', () => {
		const g = parseShowGrants(
			[
				"GRANT USAGE ON *.* TO `u`@`%` IDENTIFIED VIA mysql_native_password USING 'h' OR unix_socket"
			],
			ma114
		);
		expect(g.tail.plugins).toEqual(['mysql_native_password']);
		expect(parseShowGrants(['GRANT USAGE ON *.* TO `tmp_t7a_role`'], ma114).unparsed).toEqual([]);
	});
});

describe('tail parser', () => {
	it('ignores keywords inside string literals', () => {
		const t = parseGrantTail(" IDENTIFIED BY PASSWORD '*WITH GRANT OPTION REQUIRE SSL'");
		expect(t.grantOption).toBe(false);
		expect(t.ssl).toBeUndefined();
		expect(t.passwordHash).toBe('*WITH GRANT OPTION REQUIRE SSL');
	});
});
