/** Account / target quoting shared by every privilege statement. */
import { escapeId, quoteValue } from '#lib/sql/escape.ts';
import type { Account, GrantTarget, PrivilegeItem, PrivServer } from './types.ts';

/** `'user'@'host'` with both parts escaped as string literals. */
export function quoteAccount(account: Account): string {
	if (account.noHost) return quoteValue(account.user);
	return `${quoteValue(account.user)}@${quoteValue(account.host)}`;
}

/**
 * Split the `user@host` text of CURRENT_USER() / USER() at the last `@`
 * (host names never contain one, user names may).
 */
export function parseAccountString(value: string): Account {
	const at = value.lastIndexOf('@');
	if (at < 0) return { user: value, host: '' };
	return { user: value.slice(0, at), host: value.slice(at + 1) };
}

/** Util::escapeMysqlWildcards: `my_db` -> `my\_db` (for GRANT on a database that contains `_` or `%`). */
export function escapeWildcards(name: string): string {
	return name.replace(/[_%]/g, (c) => '\\' + c);
}

/** Util::unescapeMysqlWildcards: `my\_db` -> `my_db`. */
export function unescapeWildcards(name: string): string {
	return name.replace(/\\([_%])/g, '$1');
}

/** Does the database name contain an unescaped `_` or `%` (i.e. is it a wildcard pattern)? */
export function isWildcardDb(name: string): boolean {
	return /(?<!\\)[_%]/.test(name);
}

/**
 * The object part of GRANT/REVOKE (Privileges::wildcardEscapeForGrant).
 * Database targets keep the name verbatim (it may be a pattern such as `app\_%`); table, column and routine
 * targets address one real object, so wildcard escapes are removed (MySQL rejects them there).
 */
export function formatTarget(target: GrantTarget): string {
	switch (target.scope) {
		case 'global':
			return '*.*';
		case 'database':
			return escapeId(target.db) + '.*';
		case 'table':
			return escapeId(unescapeWildcards(target.db)) + '.' + escapeId(target.table);
		case 'routine':
			return `${target.type} ${escapeId(unescapeWildcards(target.db))}.${escapeId(target.routine)}`;
	}
}

/** One entry of a GRANT privilege list: `SELECT` or `SELECT (`a`, `b`)`. */
export function formatPrivilege(item: PrivilegeItem): string {
	if (typeof item === 'string') return item;
	if (item.columns.length === 0) throw new Error('A column privilege needs at least one column');
	return `${item.name} (${item.columns.map((c) => escapeId(c)).join(', ')})`;
}

/**
 * A role reference as GRANT/DROP ROLE expect it: an identifier on MariaDB, an account (`'role'@'%'`) on MySQL.
 */
export function quoteRole(server: PrivServer, name: string, host = '%'): string {
	return server.isMariaDB ? escapeId(name) : quoteAccount({ user: name, host });
}
