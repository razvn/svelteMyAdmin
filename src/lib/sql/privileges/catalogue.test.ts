import { describe, expect, it } from 'vitest';
import {
	allPrivilegeNames,
	authPluginsFor,
	defaultAuthPlugin,
	describePrivilege,
	findPrivilege,
	groupedPrivileges,
	isDynamicPrivilege,
	normalizePrivilegeName,
	privilegesFor
} from './index.ts';

const mysql84 = { isMariaDB: false, version: 80413 };
const mysql57 = { isMariaDB: false, version: 50744 };
const maria114 = { isMariaDB: true, version: 110413 };
const maria104 = { isMariaDB: true, version: 100411 };
const maria102 = { isMariaDB: true, version: 100200 };

const names = (scope: Parameters<typeof privilegesFor>[0], s: typeof mysql84) =>
	privilegesFor(scope, s).map((p) => p.name);

describe('privilege catalogue', () => {
	it('lists the global privileges of MySQL 8.4 incl. roles and dynamic ones', () => {
		const n = names('global', mysql84);
		expect(n).toContain('CREATE ROLE');
		expect(n).toContain('DROP ROLE');
		expect(n).toContain('REPLICATION CLIENT');
		expect(n).toContain('SYSTEM_VARIABLES_ADMIN');
		expect(n).toContain('FLUSH_PRIVILEGES');
		expect(n).not.toContain('BINLOG MONITOR');
		expect(n).not.toContain('DELETE HISTORY');
	});

	it('gates MySQL features by version', () => {
		const n = names('global', mysql57);
		expect(n).not.toContain('CREATE ROLE');
		expect(n).not.toContain('SYSTEM_VARIABLES_ADMIN');
		expect(n).toContain('CREATE TABLESPACE');
		expect(names('global', { isMariaDB: false, version: 80020 })).toContain('SHOW_ROUTINE');
		expect(names('global', { isMariaDB: false, version: 80019 })).not.toContain('SHOW_ROUTINE');
		expect(names('global', { isMariaDB: false, version: 80300 })).not.toContain(
			'OPTIMIZE_LOCAL_TABLE'
		);
	});

	it('lists the global privileges of MariaDB 11.4 (BINLOG MONITOR replaces REPLICATION CLIENT)', () => {
		const n = names('global', maria114);
		for (const p of [
			'BINLOG ADMIN',
			'BINLOG MONITOR',
			'BINLOG REPLAY',
			'CONNECTION ADMIN',
			'FEDERATED ADMIN',
			'READ_ONLY ADMIN',
			'REPLICATION MASTER ADMIN',
			'REPLICATION SLAVE ADMIN',
			'SET USER',
			'SLAVE MONITOR',
			'DELETE HISTORY',
			'SHOW CREATE ROUTINE'
		]) {
			expect(n).toContain(p);
		}
		expect(n).not.toContain('REPLICATION CLIENT');
		expect(n).not.toContain('CREATE ROLE');
		expect(n).not.toContain('SYSTEM_VARIABLES_ADMIN');
	});

	it('gates MariaDB features by version', () => {
		expect(names('global', maria104)).toContain('REPLICATION CLIENT');
		expect(names('global', maria104)).toContain('DELETE HISTORY');
		expect(names('global', maria104)).not.toContain('BINLOG MONITOR');
		expect(names('global', maria104)).not.toContain('SHOW CREATE ROUTINE');
		expect(names('global', maria102)).not.toContain('DELETE HISTORY');
	});

	it('restricts privileges per scope', () => {
		expect(names('database', mysql84)).toEqual([
			'SELECT',
			'INSERT',
			'UPDATE',
			'DELETE',
			'CREATE',
			'ALTER',
			'INDEX',
			'DROP',
			'CREATE TEMPORARY TABLES',
			'SHOW VIEW',
			'CREATE ROUTINE',
			'ALTER ROUTINE',
			'EXECUTE',
			'CREATE VIEW',
			'EVENT',
			'TRIGGER',
			'LOCK TABLES',
			'REFERENCES'
		]);
		expect(names('table', mysql84)).toEqual([
			'SELECT',
			'INSERT',
			'UPDATE',
			'DELETE',
			'CREATE',
			'ALTER',
			'INDEX',
			'DROP',
			'SHOW VIEW',
			'CREATE VIEW',
			'TRIGGER',
			'REFERENCES'
		]);
		expect(names('column', mysql84)).toEqual(['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']);
		expect(names('routine', mysql84)).toEqual(['ALTER ROUTINE', 'EXECUTE']);
		expect(names('routine', maria114)).toEqual(['ALTER ROUTINE', 'EXECUTE', 'SHOW CREATE ROUTINE']);
		expect(names('table', maria114)).toContain('DELETE HISTORY');
		expect(names('database', maria114)).toContain('DELETE HISTORY');
		expect(names('database', mysql84)).not.toContain('FILE');
	});

	it('groups the global grid like phpMyAdmin: Data / Structure / Administration (+ dynamic)', () => {
		const groups = groupedPrivileges('global', mysql84);
		expect(groups.map((g) => g.label)).toEqual([
			'Data',
			'Structure',
			'Administration',
			'Dynamic privileges'
		]);
		expect(groups[0].items.map((p) => p.name)).toEqual([
			'SELECT',
			'INSERT',
			'UPDATE',
			'DELETE',
			'FILE'
		]);
		expect(groupedPrivileges('global', maria114).map((g) => g.label)).toEqual([
			'Data',
			'Structure',
			'Administration'
		]);
		expect(groupedPrivileges('table', mysql84).map((g) => g.label)).toEqual([
			'Data',
			'Structure',
			'Administration'
		]);
	});

	it('ALL PRIVILEGES never includes dynamic privileges', () => {
		const all = allPrivilegeNames('global', mysql84);
		expect(all).toContain('CREATE USER');
		expect(all).not.toContain('SYSTEM_VARIABLES_ADMIN');
		expect(allPrivilegeNames('column', maria114)).toEqual([
			'SELECT',
			'INSERT',
			'UPDATE',
			'REFERENCES'
		]);
	});

	it('has a description for every privilege and scope specific wording', () => {
		for (const s of [mysql84, maria114]) {
			for (const p of privilegesFor('global', s)) {
				expect(describePrivilege(p, 'global', s).length).toBeGreaterThan(5);
			}
		}
		const create = findPrivilege('CREATE')!;
		expect(describePrivilege(create, 'global', mysql84)).toBe(
			'Allows creating new databases and tables.'
		);
		expect(describePrivilege(create, 'table', mysql84)).toBe('Allows creating new tables.');
		const refs = findPrivilege('REFERENCES')!;
		expect(describePrivilege(refs, 'global', maria114)).toBe('Not used on MariaDB.');
		expect(describePrivilege(refs, 'global', mysql84)).toBe(
			'Allows creating foreign key relations.'
		);
	});

	it('knows the mysql.user column of the static privileges', () => {
		expect(findPrivilege('CREATE TEMPORARY TABLES')?.column).toBe('Create_tmp_table_priv');
		expect(findPrivilege('SHOW DATABASES')?.column).toBe('Show_db_priv');
		expect(findPrivilege('SYSTEM_VARIABLES_ADMIN')?.column).toBeUndefined();
		expect(isDynamicPrivilege('SYSTEM_VARIABLES_ADMIN')).toBe(true);
		expect(isDynamicPrivilege('SELECT')).toBe(false);
	});

	it('normalizes privilege keywords reported by the server', () => {
		expect(normalizePrivilegeName('select', mysql84)).toBe('SELECT');
		expect(normalizePrivilegeName('  Create   Temporary Tables ', mysql84)).toBe(
			'CREATE TEMPORARY TABLES'
		);
		expect(normalizePrivilegeName('ALL', mysql84)).toBe('ALL PRIVILEGES');
		expect(normalizePrivilegeName('DELETE VERSIONING ROWS', maria104)).toBe('DELETE HISTORY');
		expect(normalizePrivilegeName('REPLICATION CLIENT', maria114)).toBe('BINLOG MONITOR');
		expect(normalizePrivilegeName('REPLICATION CLIENT', maria104)).toBe('REPLICATION CLIENT');
		expect(normalizePrivilegeName('REPLICATION CLIENT', mysql84)).toBe('REPLICATION CLIENT');
		expect(normalizePrivilegeName('REPLICA MONITOR', maria114)).toBe('SLAVE MONITOR');
	});
});

describe('authentication plugins', () => {
	it('defaults per server', () => {
		expect(defaultAuthPlugin(mysql84)).toBe('caching_sha2_password');
		expect(defaultAuthPlugin(mysql57)).toBe('mysql_native_password');
		expect(defaultAuthPlugin(maria114)).toBe('mysql_native_password');
	});

	it('offers the installed plugins of the server', () => {
		const my = authPluginsFor(mysql84, [
			{ name: 'sha256_password' },
			{ name: 'caching_sha2_password' },
			{ name: 'mysql_native_password' }
		]).map((p) => p.name);
		expect(my).toEqual(['caching_sha2_password', 'mysql_native_password', 'sha256_password']);
		const ma = authPluginsFor(maria114, [
			{ name: 'mysql_native_password' },
			{ name: 'mysql_old_password' },
			{ name: 'unix_socket' },
			{ name: 'ed25519' }
		]);
		expect(ma.map((p) => p.name)).toEqual(['mysql_native_password', 'ed25519', 'unix_socket']);
		expect(ma.find((p) => p.name === 'unix_socket')?.passwordless).toBe(true);
	});

	it('does not offer plugins of the other flavour and falls back without a plugin list', () => {
		expect(
			authPluginsFor(maria114, [{ name: 'caching_sha2_password' }]).map((p) => p.name)
		).toEqual(['caching_sha2_password']); // unknown to MariaDB's catalogue but active: shown as installed
		expect(authPluginsFor(mysql84).map((p) => p.name)).toEqual([
			'caching_sha2_password',
			'mysql_native_password',
			'sha256_password'
		]);
		expect(authPluginsFor(maria114).map((p) => p.name)).toEqual(['mysql_native_password']);
	});
});
