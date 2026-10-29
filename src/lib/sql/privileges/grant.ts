/**
 * GRANT / REVOKE builders for a privilege set at any scope, and the diff between the privileges an account has
 * and the ones requested (Privileges::updatePrivileges, getMessageAndSqlQueryForPrivilegesRevoke,
 * addUserAndCreateDatabase).
 */
import { escapeId } from '#lib/sql/escape.ts';
import {
	escapeWildcards,
	formatPrivilege,
	formatTarget,
	quoteAccount,
	quoteRole
} from './account.ts';
import { findPrivilege, isDynamicPrivilege } from './catalogue.ts';
import {
	stmt,
	type Account,
	type GrantTarget,
	type PrivilegeItem,
	type PrivServer,
	type Stmt
} from './types.ts';

function assertTargetAllows(items: readonly PrivilegeItem[], target: GrantTarget): void {
	const scope = target.scope;
	for (const item of items) {
		const name = typeof item === 'string' ? item : item.name;
		if (name === 'ALL PRIVILEGES' || name === 'USAGE') continue;
		if (!/^[A-Za-z_][A-Za-z_ ]*$/.test(name)) throw new Error(`Invalid privilege name: ${name}`);
		if (isDynamicPrivilege(name) && scope !== 'global') {
			throw new Error(`${name} can only be granted globally`);
		}
		const def = findPrivilege(name);
		if (def && !def.scopes.includes(scope)) {
			throw new Error(`${name} cannot be granted on a ${scope}`);
		}
	}
}

export interface GrantOptions {
	account: Account;
	target: GrantTarget;
	/** Privileges to grant; empty = USAGE (no privileges). */
	privileges: readonly PrivilegeItem[];
	/** `GRANT ALL PRIVILEGES` instead of a list. */
	all?: boolean;
	grantOption?: boolean;
}

/** `GRANT a, b ON target TO 'u'@'h' [WITH GRANT OPTION]`. */
export function buildGrant(o: GrantOptions): Stmt {
	const items = o.all ? ['ALL PRIVILEGES'] : o.privileges.map(formatPrivilege);
	if (!o.all) assertTargetAllows(o.privileges, o.target);
	const list = items.length ? items.join(', ') : 'USAGE';
	return stmt(
		`GRANT ${list} ON ${formatTarget(o.target)} TO ${quoteAccount(o.account)}` +
			(o.grantOption ? ' WITH GRANT OPTION' : '')
	);
}

/** `REVOKE a, b ON target FROM 'u'@'h'`. */
export function buildRevoke(o: Omit<GrantOptions, 'grantOption'>): Stmt {
	const items = o.all ? ['ALL PRIVILEGES'] : o.privileges.map(formatPrivilege);
	if (items.length === 0) throw new Error('Nothing to revoke');
	if (!o.all) assertTargetAllows(o.privileges, o.target);
	return stmt(
		`REVOKE ${items.join(', ')} ON ${formatTarget(o.target)} FROM ${quoteAccount(o.account)}`
	);
}

/** `REVOKE GRANT OPTION ON target FROM 'u'@'h'`. */
export const buildRevokeGrantOption = (account: Account, target: GrantTarget): Stmt =>
	stmt(`REVOKE GRANT OPTION ON ${formatTarget(target)} FROM ${quoteAccount(account)}`);

/**
 * Revoke everything an account has on `target`: the two statements phpMyAdmin runs
 * (`REVOKE ALL PRIVILEGES`, then `REVOKE GRANT OPTION`).
 */
export function buildRevokeAll(account: Account, target: GrantTarget): Stmt[] {
	return [
		stmt(`REVOKE ALL PRIVILEGES ON ${formatTarget(target)} FROM ${quoteAccount(account)}`),
		buildRevokeGrantOption(account, target)
	];
}

export interface PrivilegeDiff {
	grant: string[];
	revoke: string[];
}

/** Which privileges must be granted / revoked to go from `current` to `desired` (order of the inputs kept). */
export function diffPrivileges(
	current: Iterable<string>,
	desired: Iterable<string>
): PrivilegeDiff {
	const cur = new Set(current);
	const want = new Set(desired);
	return {
		grant: [...want].filter((p) => !cur.has(p)),
		revoke: [...cur].filter((p) => !want.has(p))
	};
}

export interface PrivilegeChangeInput {
	account: Account;
	target: GrantTarget;
	current: Iterable<string>;
	desired: Iterable<string>;
	currentGrantOption: boolean;
	grantOption: boolean;
}

/**
 * Statements to move an account's privileges on one target from `current` to `desired`:
 * REVOKE of the removed ones, REVOKE GRANT OPTION, then one GRANT for the added ones (carrying
 * WITH GRANT OPTION when the option is wanted and new, or when dynamic privileges are added).
 * Returns [] when nothing changes.
 */
export function buildPrivilegeChanges(i: PrivilegeChangeInput): Stmt[] {
	const { grant, revoke } = diffPrivileges(i.current, i.desired);
	const out: Stmt[] = [];
	if (revoke.length)
		out.push(buildRevoke({ account: i.account, target: i.target, privileges: revoke }));
	if (i.currentGrantOption && !i.grantOption) out.push(buildRevokeGrantOption(i.account, i.target));
	const newOption = i.grantOption && !i.currentGrantOption;
	if (grant.length || newOption) {
		out.push(
			buildGrant({
				account: i.account,
				target: i.target,
				privileges: grant,
				grantOption: i.grantOption && (newOption || grant.length > 0)
			})
		);
	}
	return out;
}

/** Column privileges of a table: privilege name -> columns. */
export type ColumnPrivileges = Record<string, readonly string[]>;

/** REVOKE / GRANT statements to move column privileges of one table from `current` to `desired`. */
export function buildColumnPrivilegeChanges(
	account: Account,
	target: Extract<GrantTarget, { scope: 'table' }>,
	current: ColumnPrivileges,
	desired: ColumnPrivileges
): Stmt[] {
	const revoke: PrivilegeItem[] = [];
	const grant: PrivilegeItem[] = [];
	for (const name of new Set([...Object.keys(current), ...Object.keys(desired)])) {
		const { grant: add, revoke: del } = diffPrivileges(current[name] ?? [], desired[name] ?? []);
		if (del.length) revoke.push({ name, columns: del });
		if (add.length) grant.push({ name, columns: add });
	}
	const out: Stmt[] = [];
	if (revoke.length) out.push(buildRevoke({ account, target, privileges: revoke }));
	if (grant.length) out.push(buildGrant({ account, target, privileges: grant }));
	return out;
}

/** The three optional grants of the "Database for user account" box of Add user account. */
export interface DatabaseGrantChoice {
	/** Create a database named like the user and grant all privileges on it. */
	createSameName?: boolean;
	/** Grant all privileges on the wildcard name `user\_%`. */
	wildcard?: boolean;
	/** Grant all privileges on this existing database. */
	database?: string;
}

/**
 * `CREATE DATABASE` / `GRANT ALL PRIVILEGES` statements for a new account
 * (Privileges::addUserAndCreateDatabase). Wildcard characters in the user name are escaped.
 */
export function buildDatabaseGrants(account: Account, choice: DatabaseGrantChoice): Stmt[] {
	const out: Stmt[] = [];
	const all = (db: string) =>
		buildGrant({ account, target: { scope: 'database', db }, privileges: [], all: true });
	if (choice.createSameName) {
		out.push(stmt(`CREATE DATABASE IF NOT EXISTS ${escapeId(account.user)}`));
		out.push(all(escapeWildcards(account.user)));
	}
	if (choice.wildcard) out.push(all(escapeWildcards(account.user) + '\\_%'));
	if (choice.database) out.push(all(choice.database));
	return out;
}

// ---- roles (MariaDB: GRANT role TO user; MySQL 8: roles are accounts) ----

export const buildCreateRole = (server: PrivServer, name: string, host = '%'): Stmt =>
	stmt(`CREATE ROLE ${quoteRole(server, name, host)}`);

export const buildDropRole = (server: PrivServer, name: string, host = '%'): Stmt =>
	stmt(`DROP ROLE ${quoteRole(server, name, host)}`);

/** `GRANT role TO user [WITH ADMIN OPTION]`. */
export function buildGrantRole(
	server: PrivServer,
	role: string,
	to: Account,
	adminOption = false,
	roleHost = '%'
): Stmt {
	return stmt(
		`GRANT ${quoteRole(server, role, roleHost)} TO ${quoteAccount(to)}` +
			(adminOption ? ' WITH ADMIN OPTION' : '')
	);
}

export const buildRevokeRole = (
	server: PrivServer,
	role: string,
	from: Account,
	roleHost = '%'
): Stmt => stmt(`REVOKE ${quoteRole(server, role, roleHost)} FROM ${quoteAccount(from)}`);

/** `SET DEFAULT ROLE ... FOR user` (MySQL) / `SET DEFAULT ROLE r FOR user` (MariaDB 10.1.1+). */
export function buildSetDefaultRole(
	server: PrivServer,
	roles: string[] | 'NONE' | 'ALL',
	account: Account,
	roleHost = '%'
): Stmt {
	const list =
		roles === 'NONE' || roles === 'ALL'
			? roles
			: roles.map((r) => quoteRole(server, r, roleHost)).join(', ');
	if (server.isMariaDB) {
		if (Array.isArray(roles) && roles.length !== 1) {
			throw new Error('MariaDB takes exactly one default role (or NONE)');
		}
		return stmt(`SET DEFAULT ROLE ${list} FOR ${quoteAccount(account)}`);
	}
	return stmt(`SET DEFAULT ROLE ${list} TO ${quoteAccount(account)}`);
}

/** `SHOW GRANTS FOR 'u'@'h'`. */
export const buildShowGrants = (account: Account): string =>
	`SHOW GRANTS FOR ${quoteAccount(account)}`;
