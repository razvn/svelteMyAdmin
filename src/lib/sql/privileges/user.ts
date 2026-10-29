/**
 * CREATE USER / ALTER USER / SET PASSWORD / DROP USER / RENAME USER builders
 * (Privileges::getSqlQueriesForDisplayAndAddUser, updatePassword, UserPassword::changePassword).
 * Every value goes through quoteValue; every `display` form hides passwords behind `***`.
 */
import { escapeId, quoteValue } from '#lib/sql/escape.ts';
import { quoteAccount } from './account.ts';
import { findAuthPlugin, isValidPluginName, NATIVE_PLUGIN } from './auth-plugins.ts';
import {
	NO_LIMITS,
	stmt,
	type Account,
	type PrivServer,
	type ResourceLimits,
	type SslRequirement,
	type Stmt
} from './types.ts';

const MASK = "'***'";

/** MySQL >= 8.0.11 and MariaDB >= 10.2 take REQUIRE / WITH limits through ALTER USER, older ones through GRANT USAGE. */
export function supportsAlterUserOptions(server: PrivServer): boolean {
	return server.isMariaDB ? server.version >= 100200 : server.version >= 80011;
}

/** ACCOUNT LOCK: MySQL 5.7.6+, MariaDB 10.4.2+. */
export function supportsAccountLocking(server: PrivServer): boolean {
	return server.isMariaDB ? server.version >= 100402 : server.version >= 50706;
}

/** PASSWORD EXPIRE: MySQL 5.7.6+, MariaDB 10.4.3+. */
export function supportsPasswordExpire(server: PrivServer): boolean {
	return server.isMariaDB ? server.version >= 100403 : server.version >= 50706;
}

export interface AuthOptions {
	/** Authentication plugin; omitted = the server default. */
	plugin?: string;
	/** Clear text password; '' / undefined = no password. */
	password?: string;
	/** Pre-hashed credential (as found in `authentication_string`); wins over `password`. */
	passwordHash?: string;
}

function assertPlugin(name: string): string {
	if (!isValidPluginName(name)) throw new Error(`Invalid authentication plugin name: ${name}`);
	return name;
}

/**
 * The IDENTIFIED ... part of CREATE USER, or null for an account without password on the default plugin.
 *
 * MySQL: `IDENTIFIED [WITH plugin] BY 'pw'` / `IDENTIFIED WITH plugin AS 'hash'`.
 * MariaDB: `IDENTIFIED BY 'pw'` for the native plugin, `IDENTIFIED VIA plugin USING PASSWORD('pw')` otherwise,
 * `IDENTIFIED BY PASSWORD 'hash'` / `IDENTIFIED VIA plugin USING 'hash'` for hashes.
 */
export function buildIdentified(server: PrivServer, auth: AuthOptions): Stmt | null {
	const plugin = auth.plugin ? assertPlugin(auth.plugin) : undefined;
	const passwordless = plugin !== undefined && findAuthPlugin(plugin)?.passwordless === true;
	const hash = auth.passwordHash ?? '';
	const password = auth.password ?? '';

	if (server.isMariaDB) {
		if (passwordless) return stmt(` IDENTIFIED VIA ${plugin}`);
		const native = plugin === undefined || plugin === NATIVE_PLUGIN;
		if (hash !== '') {
			return native
				? stmt(` IDENTIFIED BY PASSWORD ${quoteValue(hash)}`, ` IDENTIFIED BY PASSWORD ${MASK}`)
				: stmt(
						` IDENTIFIED VIA ${plugin} USING ${quoteValue(hash)}`,
						` IDENTIFIED VIA ${plugin} USING ${MASK}`
					);
		}
		if (password === '') return native ? null : stmt(` IDENTIFIED VIA ${plugin}`);
		return native
			? stmt(` IDENTIFIED BY ${quoteValue(password)}`, ` IDENTIFIED BY ${MASK}`)
			: stmt(
					` IDENTIFIED VIA ${plugin} USING PASSWORD(${quoteValue(password)})`,
					` IDENTIFIED VIA ${plugin} USING PASSWORD(${MASK})`
				);
	}

	const withPlugin = plugin ? ` WITH ${plugin}` : '';
	if (passwordless) return stmt(` IDENTIFIED WITH ${plugin}`);
	if (hash !== '') {
		const p = plugin ?? NATIVE_PLUGIN;
		return stmt(` IDENTIFIED WITH ${p} AS ${quoteValue(hash)}`, ` IDENTIFIED WITH ${p} AS ${MASK}`);
	}
	if (password === '') return plugin ? stmt(` IDENTIFIED WITH ${plugin}`) : null;
	return stmt(
		` IDENTIFIED${withPlugin} BY ${quoteValue(password)}`,
		` IDENTIFIED${withPlugin} BY ${MASK}`
	);
}

/** ` REQUIRE ...` (Privileges::getRequireClause). */
export function buildRequireClause(ssl: SslRequirement): string {
	switch (ssl.type) {
		case 'ANY':
			return ' REQUIRE SSL';
		case 'X509':
			return ' REQUIRE X509';
		case 'SPECIFIED': {
			const parts: string[] = [];
			if (ssl.cipher) parts.push(`CIPHER ${quoteValue(ssl.cipher)}`);
			if (ssl.issuer) parts.push(`ISSUER ${quoteValue(ssl.issuer)}`);
			if (ssl.subject) parts.push(`SUBJECT ${quoteValue(ssl.subject)}`);
			return parts.length ? ` REQUIRE ${parts.join(' AND ')}` : ' REQUIRE NONE';
		}
		default:
			return ' REQUIRE NONE';
	}
}

const limit = (n: number | undefined): number => Math.max(0, Math.floor(Number(n) || 0));

const LIMIT_KEYS = [
	['maxQuestions', 'MAX_QUERIES_PER_HOUR'],
	['maxConnections', 'MAX_CONNECTIONS_PER_HOUR'],
	['maxUpdates', 'MAX_UPDATES_PER_HOUR'],
	['maxUserConnections', 'MAX_USER_CONNECTIONS']
] as const;

/**
 * ` WITH MAX_QUERIES_PER_HOUR n ...` for the given keys (default: all four, in phpMyAdmin's order).
 * Returns '' when there is nothing to emit.
 */
export function buildLimitsClause(
	limits: Partial<ResourceLimits>,
	only?: readonly (keyof ResourceLimits)[]
): string {
	const parts = LIMIT_KEYS.filter(
		([k]) => limits[k] !== undefined && (!only || only.includes(k))
	).map(([k, sql]) => `${sql} ${limit(limits[k])}`);
	return parts.length ? ` WITH ${parts.join(' ')}` : '';
}

export interface AccountOptions {
	ssl?: SslRequirement;
	limits?: Partial<ResourceLimits>;
	/** ACCOUNT LOCK (true) / ACCOUNT UNLOCK (false) where the server supports it. */
	accountLocked?: boolean;
	/** PASSWORD EXPIRE (true). */
	passwordExpire?: boolean;
}

export interface CreateUserOptions extends AuthOptions, AccountOptions {
	account: Account;
	ifNotExists?: boolean;
}

/** `ACCOUNT LOCK` / `PASSWORD EXPIRE` suffix (lock first: MariaDB's grammar needs this order). */
function lockAndExpire(server: PrivServer, o: AccountOptions): string {
	let out = '';
	if (o.accountLocked !== undefined && supportsAccountLocking(server)) {
		out += o.accountLocked ? ' ACCOUNT LOCK' : ' ACCOUNT UNLOCK';
	}
	if (o.passwordExpire && supportsPasswordExpire(server)) out += ' PASSWORD EXPIRE';
	return out;
}

/**
 * `CREATE USER 'u'@'h' IDENTIFIED ... REQUIRE ... WITH MAX_... ACCOUNT LOCK PASSWORD EXPIRE`.
 * REQUIRE NONE and zero limits are the defaults and are not written.
 */
export function buildCreateUser(server: PrivServer, o: CreateUserOptions): Stmt {
	let sql = `CREATE USER ${o.ifNotExists ? 'IF NOT EXISTS ' : ''}${quoteAccount(o.account)}`;
	let display = sql;
	const identified = buildIdentified(server, o);
	if (identified) {
		sql += identified.sql;
		display += identified.display;
	}
	let rest = '';
	if (o.ssl && o.ssl.type !== 'NONE') rest += buildRequireClause(o.ssl);
	if (o.limits) {
		const nonZero = LIMIT_KEYS.map(([k]) => k).filter((k) => limit(o.limits?.[k]) > 0);
		rest += buildLimitsClause(o.limits, nonZero);
	}
	rest += lockAndExpire(server, o);
	return stmt(sql + rest, display + rest);
}

/**
 * Change REQUIRE / limits / lock / expiry of an existing account (ALTER USER, or GRANT USAGE on old servers).
 * Returns null when no option is given.
 */
export function buildAlterUserOptions(
	server: PrivServer,
	account: Account,
	o: AccountOptions & { limitKeys?: readonly (keyof ResourceLimits)[] }
): Stmt | null {
	let rest = '';
	if (o.ssl) rest += buildRequireClause(o.ssl);
	if (o.limits) rest += buildLimitsClause(o.limits, o.limitKeys);
	rest += lockAndExpire(server, o);
	if (rest === '') return null;
	if (supportsAlterUserOptions(server)) {
		return stmt(`ALTER USER ${quoteAccount(account)}${rest}`);
	}
	return stmt(`GRANT USAGE ON *.* TO ${quoteAccount(account)}${rest}`);
}

export interface ChangePasswordOptions {
	account: Account;
	/** New clear text password; '' removes the password. */
	password: string;
	/** Plugin to hash with. */
	plugin?: string;
	/** Plugin the account uses now (decides whether the plugin changes). */
	currentPlugin?: string;
}

/**
 * Change an account's password.
 *
 * MySQL: `ALTER USER u IDENTIFIED [WITH plugin] BY 'pw'` (WITH only when the plugin changes: since 5.7.37 naming
 * the same plugin demands CREATE USER). MariaDB: `SET PASSWORD FOR u = PASSWORD('pw')` for the native plugin,
 * `ALTER USER u IDENTIFIED VIA plugin USING PASSWORD('pw')` otherwise.
 */
export function buildChangePassword(server: PrivServer, o: ChangePasswordOptions): Stmt {
	const who = quoteAccount(o.account);
	const plugin = o.plugin || o.currentPlugin || undefined;
	if (plugin) assertPlugin(plugin);
	const changed = !!o.plugin && !!o.currentPlugin && o.plugin !== o.currentPlugin;
	const pw = quoteValue(o.password);
	const shown = o.password === '' ? "''" : MASK;
	if (server.isMariaDB) {
		const native = plugin === undefined || plugin === NATIVE_PLUGIN;
		if (native && !changed) {
			return stmt(
				`SET PASSWORD FOR ${who} = PASSWORD(${pw})`,
				`SET PASSWORD FOR ${who} = PASSWORD(${shown})`
			);
		}
		return stmt(
			`ALTER USER ${who} IDENTIFIED VIA ${plugin} USING PASSWORD(${pw})`,
			`ALTER USER ${who} IDENTIFIED VIA ${plugin} USING PASSWORD(${shown})`
		);
	}
	const withPlugin = changed ? ` WITH ${plugin}` : '';
	return stmt(
		`ALTER USER ${who} IDENTIFIED${withPlugin} BY ${pw}`,
		`ALTER USER ${who} IDENTIFIED${withPlugin} BY ${shown}`
	);
}

export const buildDropUser = (account: Account, ifExists = false): Stmt =>
	stmt(`DROP USER ${ifExists ? 'IF EXISTS ' : ''}${quoteAccount(account)}`);

export const buildRenameUser = (from: Account, to: Account): Stmt =>
	stmt(`RENAME USER ${quoteAccount(from)} TO ${quoteAccount(to)}`);

/** `DROP DATABASE IF EXISTS `name`` (the "drop the databases that have the same names as the users" option). */
export const buildDropDatabase = (name: string): Stmt =>
	stmt(`DROP DATABASE IF EXISTS ${escapeId(name)}`);

export const buildFlushPrivileges = (): Stmt => stmt('FLUSH PRIVILEGES');

export const hasNoLimits = (l: ResourceLimits): boolean =>
	LIMIT_KEYS.every(([k]) => limit(l[k]) === NO_LIMITS[k]);
