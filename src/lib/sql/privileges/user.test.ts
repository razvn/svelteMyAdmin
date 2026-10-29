import { describe, expect, it } from 'vitest';
import {
	buildAlterUserOptions,
	buildChangePassword,
	buildCreateUser,
	buildDropDatabase,
	buildDropUser,
	buildIdentified,
	buildLimitsClause,
	buildRenameUser,
	buildRequireClause,
	parseAccountString,
	quoteAccount,
	supportsAccountLocking,
	supportsAlterUserOptions,
	supportsPasswordExpire
} from './index.ts';

const my84 = { isMariaDB: false, version: 80413 };
const my57 = { isMariaDB: false, version: 50744 };
const ma114 = { isMariaDB: true, version: 110413 };
const ma102 = { isMariaDB: true, version: 100200 };
const ma101 = { isMariaDB: true, version: 100100 };
const acc = { user: 'bob', host: '%' };

describe('account quoting', () => {
	it('escapes quotes, backslashes and wildcards in the host', () => {
		expect(quoteAccount({ user: "o'brien", host: '192.168.%' })).toBe("'o\\'brien'@'192.168.%'");
		expect(quoteAccount({ user: 'a\\b', host: 'h"x' })).toBe("'a\\\\b'@'h\\\"x'");
		expect(quoteAccount({ user: '', host: 'localhost' })).toBe("''@'localhost'");
	});

	it('splits CURRENT_USER() at the last @', () => {
		expect(parseAccountString('root@localhost')).toEqual({ user: 'root', host: 'localhost' });
		expect(parseAccountString('we@ird@%')).toEqual({ user: 'we@ird', host: '%' });
		expect(parseAccountString('x')).toEqual({ user: 'x', host: '' });
	});
});

describe('IDENTIFIED clause', () => {
	it('MySQL 8.4', () => {
		expect(buildIdentified(my84, {})).toBeNull();
		expect(buildIdentified(my84, { password: '' })).toBeNull();
		expect(buildIdentified(my84, { password: "p'w" })).toEqual({
			sql: " IDENTIFIED BY 'p\\'w'",
			display: " IDENTIFIED BY '***'"
		});
		expect(buildIdentified(my84, { plugin: 'caching_sha2_password', password: 'pw' })?.sql).toBe(
			" IDENTIFIED WITH caching_sha2_password BY 'pw'"
		);
		expect(buildIdentified(my84, { plugin: 'sha256_password', password: 'pw' })?.display).toBe(
			" IDENTIFIED WITH sha256_password BY '***'"
		);
		expect(buildIdentified(my84, { plugin: 'mysql_native_password' })?.sql).toBe(
			' IDENTIFIED WITH mysql_native_password'
		);
		expect(
			buildIdentified(my84, { plugin: 'caching_sha2_password', passwordHash: '$A$005$xyz' })?.sql
		).toBe(" IDENTIFIED WITH caching_sha2_password AS '$A$005$xyz'");
		expect(buildIdentified(my84, { plugin: 'auth_socket' })?.sql).toBe(
			' IDENTIFIED WITH auth_socket'
		);
	});

	it('MariaDB 11.4', () => {
		expect(buildIdentified(ma114, {})).toBeNull();
		expect(buildIdentified(ma114, { plugin: 'mysql_native_password' })).toBeNull();
		expect(buildIdentified(ma114, { password: 'pw' })?.sql).toBe(" IDENTIFIED BY 'pw'");
		expect(buildIdentified(ma114, { plugin: 'mysql_native_password', password: 'pw' })?.sql).toBe(
			" IDENTIFIED BY 'pw'"
		);
		expect(buildIdentified(ma114, { plugin: 'ed25519', password: 'pw' })).toEqual({
			sql: " IDENTIFIED VIA ed25519 USING PASSWORD('pw')",
			display: " IDENTIFIED VIA ed25519 USING PASSWORD('***')"
		});
		expect(buildIdentified(ma114, { plugin: 'ed25519' })?.sql).toBe(' IDENTIFIED VIA ed25519');
		expect(buildIdentified(ma114, { plugin: 'unix_socket', password: 'ignored' })?.sql).toBe(
			' IDENTIFIED VIA unix_socket'
		);
		expect(buildIdentified(ma114, { passwordHash: '*ABC' })?.sql).toBe(
			" IDENTIFIED BY PASSWORD '*ABC'"
		);
		expect(buildIdentified(ma114, { plugin: 'ed25519', passwordHash: 'h' })?.sql).toBe(
			" IDENTIFIED VIA ed25519 USING 'h'"
		);
	});

	it('refuses plugin names that are not identifiers', () => {
		expect(() => buildIdentified(my84, { plugin: "x'; DROP USER y; --", password: 'p' })).toThrow();
		expect(() => buildIdentified(ma114, { plugin: 'a b', password: 'p' })).toThrow();
	});
});

describe('REQUIRE and WITH clauses', () => {
	it('builds REQUIRE', () => {
		expect(buildRequireClause({ type: 'NONE' })).toBe(' REQUIRE NONE');
		expect(buildRequireClause({ type: 'ANY' })).toBe(' REQUIRE SSL');
		expect(buildRequireClause({ type: 'X509' })).toBe(' REQUIRE X509');
		expect(buildRequireClause({ type: 'SPECIFIED' })).toBe(' REQUIRE NONE');
		expect(
			buildRequireClause({
				type: 'SPECIFIED',
				cipher: 'AES256-SHA',
				issuer: "/C=US/O='x'",
				subject: '/CN=a'
			})
		).toBe(" REQUIRE CIPHER 'AES256-SHA' AND ISSUER '/C=US/O=\\'x\\'' AND SUBJECT '/CN=a'");
		expect(buildRequireClause({ type: 'SPECIFIED', subject: '/CN=a' })).toBe(
			" REQUIRE SUBJECT '/CN=a'"
		);
	});

	it('builds WITH in phpMyAdmin order, clamping to non-negative integers', () => {
		expect(
			buildLimitsClause({
				maxQuestions: 5,
				maxConnections: 4,
				maxUpdates: 3,
				maxUserConnections: 2
			})
		).toBe(
			' WITH MAX_QUERIES_PER_HOUR 5 MAX_CONNECTIONS_PER_HOUR 4 MAX_UPDATES_PER_HOUR 3 MAX_USER_CONNECTIONS 2'
		);
		expect(buildLimitsClause({ maxQuestions: -3, maxUpdates: 2.9 })).toBe(
			' WITH MAX_QUERIES_PER_HOUR 0 MAX_UPDATES_PER_HOUR 2'
		);
		expect(buildLimitsClause({})).toBe('');
		expect(buildLimitsClause({ maxQuestions: 1, maxUpdates: 2 }, ['maxUpdates'])).toBe(
			' WITH MAX_UPDATES_PER_HOUR 2'
		);
	});
});

describe('CREATE USER', () => {
	it('MySQL 8.4 for each plugin', () => {
		expect(buildCreateUser(my84, { account: acc })).toEqual({
			sql: "CREATE USER 'bob'@'%'",
			display: "CREATE USER 'bob'@'%'"
		});
		expect(
			buildCreateUser(my84, { account: acc, plugin: 'caching_sha2_password', password: 's3' })
		).toEqual({
			sql: "CREATE USER 'bob'@'%' IDENTIFIED WITH caching_sha2_password BY 's3'",
			display: "CREATE USER 'bob'@'%' IDENTIFIED WITH caching_sha2_password BY '***'"
		});
		expect(
			buildCreateUser(my84, { account: acc, plugin: 'mysql_native_password', password: 's3' }).sql
		).toBe("CREATE USER 'bob'@'%' IDENTIFIED WITH mysql_native_password BY 's3'");
		expect(
			buildCreateUser(my84, { account: acc, plugin: 'sha256_password', password: 's3' }).sql
		).toBe("CREATE USER 'bob'@'%' IDENTIFIED WITH sha256_password BY 's3'");
	});

	it('MariaDB 11.4 for each plugin', () => {
		expect(buildCreateUser(ma114, { account: acc, password: 's3' }).sql).toBe(
			"CREATE USER 'bob'@'%' IDENTIFIED BY 's3'"
		);
		expect(buildCreateUser(ma114, { account: acc, plugin: 'ed25519', password: 's3' }).sql).toBe(
			"CREATE USER 'bob'@'%' IDENTIFIED VIA ed25519 USING PASSWORD('s3')"
		);
		expect(buildCreateUser(ma114, { account: acc, plugin: 'unix_socket' }).sql).toBe(
			"CREATE USER 'bob'@'%' IDENTIFIED VIA unix_socket"
		);
	});

	it('adds REQUIRE, limits, lock and expiry in the right order', () => {
		const o = {
			account: { user: 'x', host: 'localhost' },
			password: 'p',
			ssl: { type: 'ANY' as const },
			limits: { maxQuestions: 10, maxConnections: 0, maxUpdates: 0, maxUserConnections: 3 },
			accountLocked: true,
			passwordExpire: true
		};
		expect(buildCreateUser(my84, o).sql).toBe(
			"CREATE USER 'x'@'localhost' IDENTIFIED BY 'p' REQUIRE SSL WITH MAX_QUERIES_PER_HOUR 10 MAX_USER_CONNECTIONS 3 ACCOUNT LOCK PASSWORD EXPIRE"
		);
		expect(buildCreateUser(ma114, o).sql).toBe(
			"CREATE USER 'x'@'localhost' IDENTIFIED BY 'p' REQUIRE SSL WITH MAX_QUERIES_PER_HOUR 10 MAX_USER_CONNECTIONS 3 ACCOUNT LOCK PASSWORD EXPIRE"
		);
		expect(buildCreateUser(my84, o).display).toContain("IDENTIFIED BY '***' REQUIRE SSL");
	});

	it('writes neither REQUIRE NONE nor zero limits, supports IF NOT EXISTS and anonymous users', () => {
		const sql = buildCreateUser(my84, {
			account: { user: '', host: 'localhost' },
			ifNotExists: true,
			ssl: { type: 'NONE' },
			limits: { maxQuestions: 0, maxConnections: 0, maxUpdates: 0, maxUserConnections: 0 }
		}).sql;
		expect(sql).toBe("CREATE USER IF NOT EXISTS ''@'localhost'");
	});

	it('skips lock / expiry where the server cannot do it', () => {
		expect(
			buildCreateUser(ma101, { account: acc, accountLocked: true, passwordExpire: true }).sql
		).toBe("CREATE USER 'bob'@'%'");
		expect(supportsAccountLocking(ma114)).toBe(true);
		expect(supportsAccountLocking({ isMariaDB: true, version: 100402 })).toBe(true);
		expect(supportsPasswordExpire({ isMariaDB: true, version: 100402 })).toBe(false);
		expect(supportsPasswordExpire({ isMariaDB: true, version: 100403 })).toBe(true);
	});

	it('quotes hostile names', () => {
		expect(
			buildCreateUser(my84, {
				account: { user: "x'; DROP USER 'y", host: "%' --" },
				password: "a'b"
			}).sql
		).toBe("CREATE USER 'x\\'; DROP USER \\'y'@'%\\' --' IDENTIFIED BY 'a\\'b'");
	});
});

describe('ALTER USER options', () => {
	it('uses ALTER USER on MySQL 8 and MariaDB 10.2+', () => {
		const o = {
			ssl: { type: 'X509' as const },
			limits: { maxQuestions: 7, maxUpdates: 0 }
		};
		expect(buildAlterUserOptions(my84, acc, o)?.sql).toBe(
			"ALTER USER 'bob'@'%' REQUIRE X509 WITH MAX_QUERIES_PER_HOUR 7 MAX_UPDATES_PER_HOUR 0"
		);
		expect(buildAlterUserOptions(ma114, acc, o)?.sql).toBe(
			"ALTER USER 'bob'@'%' REQUIRE X509 WITH MAX_QUERIES_PER_HOUR 7 MAX_UPDATES_PER_HOUR 0"
		);
		expect(supportsAlterUserOptions(ma102)).toBe(true);
	});

	it('falls back to GRANT USAGE on old servers', () => {
		expect(buildAlterUserOptions(my57, acc, { ssl: { type: 'ANY' } })?.sql).toBe(
			"GRANT USAGE ON *.* TO 'bob'@'%' REQUIRE SSL"
		);
		expect(buildAlterUserOptions(ma101, acc, { limits: { maxUserConnections: 2 } })?.sql).toBe(
			"GRANT USAGE ON *.* TO 'bob'@'%' WITH MAX_USER_CONNECTIONS 2"
		);
	});

	it('limits the WITH list to the changed keys, locks and unlocks', () => {
		expect(
			buildAlterUserOptions(my84, acc, {
				limits: { maxQuestions: 1, maxUpdates: 9 },
				limitKeys: ['maxUpdates']
			})?.sql
		).toBe("ALTER USER 'bob'@'%' WITH MAX_UPDATES_PER_HOUR 9");
		expect(buildAlterUserOptions(my84, acc, { accountLocked: false })?.sql).toBe(
			"ALTER USER 'bob'@'%' ACCOUNT UNLOCK"
		);
		expect(
			buildAlterUserOptions(ma114, acc, { accountLocked: true, passwordExpire: true })?.sql
		).toBe("ALTER USER 'bob'@'%' ACCOUNT LOCK PASSWORD EXPIRE");
		expect(buildAlterUserOptions(my84, acc, {})).toBeNull();
	});
});

describe('change password', () => {
	it('MySQL: ALTER USER, naming the plugin only when it changes', () => {
		expect(
			buildChangePassword(my84, {
				account: acc,
				password: "n'w",
				currentPlugin: 'caching_sha2_password'
			})
		).toEqual({
			sql: "ALTER USER 'bob'@'%' IDENTIFIED BY 'n\\'w'",
			display: "ALTER USER 'bob'@'%' IDENTIFIED BY '***'"
		});
		expect(
			buildChangePassword(my84, {
				account: acc,
				password: 'x',
				plugin: 'caching_sha2_password',
				currentPlugin: 'caching_sha2_password'
			}).sql
		).toBe("ALTER USER 'bob'@'%' IDENTIFIED BY 'x'");
		expect(
			buildChangePassword(my84, {
				account: acc,
				password: 'x',
				plugin: 'sha256_password',
				currentPlugin: 'caching_sha2_password'
			}).display
		).toBe("ALTER USER 'bob'@'%' IDENTIFIED WITH sha256_password BY '***'");
		expect(buildChangePassword(my84, { account: acc, password: '' }).display).toBe(
			"ALTER USER 'bob'@'%' IDENTIFIED BY ''"
		);
	});

	it('MariaDB: SET PASSWORD for the native plugin, ALTER USER for the others', () => {
		expect(
			buildChangePassword(ma114, {
				account: acc,
				password: 'p',
				currentPlugin: 'mysql_native_password'
			})
		).toEqual({
			sql: "SET PASSWORD FOR 'bob'@'%' = PASSWORD('p')",
			display: "SET PASSWORD FOR 'bob'@'%' = PASSWORD('***')"
		});
		expect(buildChangePassword(ma114, { account: acc, password: '' }).sql).toBe(
			"SET PASSWORD FOR 'bob'@'%' = PASSWORD('')"
		);
		expect(
			buildChangePassword(ma114, { account: acc, password: 'p', currentPlugin: 'ed25519' }).sql
		).toBe("ALTER USER 'bob'@'%' IDENTIFIED VIA ed25519 USING PASSWORD('p')");
		expect(
			buildChangePassword(ma114, {
				account: acc,
				password: 'p',
				plugin: 'ed25519',
				currentPlugin: 'mysql_native_password'
			}).sql
		).toBe("ALTER USER 'bob'@'%' IDENTIFIED VIA ed25519 USING PASSWORD('p')");
	});
});

describe('DROP / RENAME', () => {
	it('builds them', () => {
		expect(buildDropUser(acc).sql).toBe("DROP USER 'bob'@'%'");
		expect(buildDropUser(acc, true).sql).toBe("DROP USER IF EXISTS 'bob'@'%'");
		expect(buildRenameUser(acc, { user: 'al', host: 'localhost' }).sql).toBe(
			"RENAME USER 'bob'@'%' TO 'al'@'localhost'"
		);
		expect(buildDropDatabase('we`ird').sql).toBe('DROP DATABASE IF EXISTS `we``ird`');
	});
});
