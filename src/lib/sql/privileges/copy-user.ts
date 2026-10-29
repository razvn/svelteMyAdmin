/**
 * "Change login information / Copy user account" planner (Privileges::getDataForChangeOrCopyUser,
 * addUser's CREATE USER part, getDbSpecificPrivsQueriesForChangeOrCopyUser, getTablePrivsQueriesForChangeOrCopyUser,
 * getDataForDeleteUsers). Pure: takes what was read from the old account, returns the statements.
 *
 * Modes (the radio buttons of phpMyAdmin):
 *  4  create the new account and keep the old one
 *  1  ... and delete the old one from the user tables
 *  2  ... revoke all active privileges from the old one and delete it afterwards
 *  3  ... delete the old one and reload the privileges afterwards
 *
 * Modes 1 and 3 are equivalent to `RENAME USER` (which also keeps roles, proxies and every grant level), so that
 * is what they run. Modes 4 and 2 copy every grant level explicitly.
 */
import { buildCreateUser, buildAlterUserOptions, supportsAlterUserOptions } from './user.ts';
import { buildDropUser, buildFlushPrivileges, buildRenameUser } from './user.ts';
import { quoteAccount } from './account.ts';
import { buildGrant, buildGrantRole, buildRevokeAll } from './grant.ts';
import {
	stmt,
	type Account,
	type GrantTarget,
	type PrivilegeItem,
	type PrivServer,
	type ResourceLimits,
	type RoutineType,
	type SslRequirement,
	type Stmt
} from './types.ts';

export type CopyMode = 1 | 2 | 3 | 4;

/** Structural subset of the parsed SHOW GRANTS of the old account. */
export interface CopyGrants {
	global: { privileges: string[]; grantOption: boolean; grantable: string[] };
	databases: { db: string; privileges: string[]; grantOption: boolean }[];
	tables: {
		db: string;
		table: string;
		privileges: string[];
		columns: { privilege: string; columns: string[] }[];
		grantOption: boolean;
	}[];
	routines: {
		db: string;
		routine: string;
		type: string;
		privileges: string[];
		grantOption: boolean;
	}[];
	proxies: { proxied: Account; grantOption: boolean }[];
	roles: { role: string; host: string | null; adminOption: boolean }[];
}

export interface CopySource {
	grants: CopyGrants;
	plugin?: string;
	/** Credential as stored (`authentication_string`). */
	passwordHash?: string;
	ssl?: SslRequirement;
	limits?: ResourceLimits;
	locked?: boolean;
	passwordExpired?: boolean;
}

export interface LoginChangePlan {
	/** Must all succeed before `cleanup` runs. */
	copy: Stmt[];
	cleanup: Stmt[];
}

export function isCopyMode(n: number): n is CopyMode {
	return n === 1 || n === 2 || n === 3 || n === 4;
}

/** GRANT statements that reproduce every privilege level of `grants` for `to`. */
export function buildCopyGrants(to: Account, grants: CopyGrants): Stmt[] {
	const out: Stmt[] = [];
	const g = grants.global;
	if (g.privileges.length > 0 || g.grantOption) {
		const all = new Set(g.privileges);
		const grantable = g.grantable.filter((p) => all.has(p));
		const plain = g.privileges.filter((p) => !grantable.includes(p));
		if (grantable.length > 0 && plain.length > 0 && !g.grantOption) {
			out.push(buildGrant({ account: to, target: { scope: 'global' }, privileges: plain }));
			out.push(
				buildGrant({
					account: to,
					target: { scope: 'global' },
					privileges: grantable,
					grantOption: true
				})
			);
		} else {
			out.push(
				buildGrant({
					account: to,
					target: { scope: 'global' },
					privileges: g.privileges,
					grantOption: g.grantOption
				})
			);
		}
	}
	for (const d of grants.databases) {
		out.push(
			buildGrant({
				account: to,
				target: { scope: 'database', db: d.db },
				privileges: d.privileges,
				grantOption: d.grantOption
			})
		);
	}
	for (const t of grants.tables) {
		const items: PrivilegeItem[] = [...t.privileges];
		for (const c of t.columns) {
			if (!t.privileges.includes(c.privilege) && c.columns.length > 0) {
				items.push({ name: c.privilege, columns: c.columns });
			}
		}
		out.push(
			buildGrant({
				account: to,
				target: { scope: 'table', db: t.db, table: t.table },
				privileges: items,
				grantOption: t.grantOption
			})
		);
	}
	for (const r of grants.routines) {
		if (r.type !== 'PROCEDURE' && r.type !== 'FUNCTION') continue;
		out.push(
			buildGrant({
				account: to,
				target: { scope: 'routine', db: r.db, routine: r.routine, type: r.type as RoutineType },
				privileges: r.privileges,
				grantOption: r.grantOption
			})
		);
	}
	for (const p of grants.proxies) {
		out.push(
			stmt(
				`GRANT PROXY ON ${quoteAccount(p.proxied)} TO ${quoteAccount(to)}` +
					(p.grantOption ? ' WITH GRANT OPTION' : '')
			)
		);
	}
	return out;
}

/**
 * Revoke what an account has on one target: `REVOKE ALL PRIVILEGES` when it has privileges and
 * `REVOKE GRANT OPTION` when it has the option (the server rejects a revoke of something that is not granted).
 */
export function buildRevokeTarget(
	account: Account,
	target: GrantTarget,
	has: { privileges: boolean; grantOption: boolean }
): Stmt[] {
	const [all, option] = buildRevokeAll(account, target);
	return [...(has.privileges ? [all] : []), ...(has.grantOption ? [option] : [])];
}

/**
 * Revoke every privilege of an account on every level in one statement (`REVOKE ALL PRIVILEGES, GRANT OPTION
 * FROM user`, supported by MySQL and MariaDB; per level revokes fail once the first one removed the rows).
 */
export const buildRevokeEverything = (from: Account): Stmt =>
	stmt(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${quoteAccount(from)}`);

/** Plan the change of user name / host (copy or rename). Throws when old and new are the same account. */
export function planChangeLogin(
	server: PrivServer,
	from: Account,
	to: Account,
	mode: CopyMode,
	src: CopySource
): LoginChangePlan {
	if (from.user === to.user && from.host === to.host) {
		throw new Error(
			"Username and hostname didn't change. If you only want to change the password, 'Change password' tab should be used."
		);
	}
	if (mode === 1 || mode === 3) {
		return {
			copy: [buildRenameUser(from, to)],
			cleanup: mode === 3 ? [buildFlushPrivileges()] : []
		};
	}
	const embed = supportsAlterUserOptions(server);
	const copy: Stmt[] = [
		buildCreateUser(server, {
			account: to,
			plugin: src.plugin || undefined,
			passwordHash: src.passwordHash || undefined,
			...(embed ? { ssl: src.ssl, limits: src.limits } : {}),
			accountLocked: src.locked ? true : undefined,
			passwordExpire: src.passwordExpired
		})
	];
	if (!embed) {
		const alter = buildAlterUserOptions(server, to, {
			ssl: src.ssl && src.ssl.type !== 'NONE' ? src.ssl : undefined,
			limits: src.limits
		});
		if (alter) copy.push(alter);
	}
	copy.push(...buildCopyGrants(to, src.grants));
	for (const r of src.grants.roles) {
		copy.push(buildGrantRole(server, r.role, to, r.adminOption, r.host ?? '%'));
	}
	const cleanup: Stmt[] = [];
	if (mode === 2) cleanup.push(buildRevokeEverything(from));
	if (mode === 2) cleanup.push(buildDropUser(from));
	return { copy, cleanup };
}
