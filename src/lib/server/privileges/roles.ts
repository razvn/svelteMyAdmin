/**
 * Roles: MySQL 8 (`CREATE ROLE 'r'@'%'`, accounts in mysql.user addressed by role_edges / default_roles) and
 * MariaDB 10.0.5+ (`CREATE ROLE r`, no host, mysql.roles_mapping, mysql.user.default_role).
 */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import {
	buildCreateRole,
	buildDropRole,
	buildGrantRole,
	buildRevokeRole,
	buildSetDefaultRole,
	supportsRoles,
	type Account,
	type PrivServer
} from '#lib/sql/privileges/index.ts';
import { listAccounts, readAccount } from './accounts.ts';
import { query, type Capabilities } from './context.ts';
import { runStatements, type OperationResult } from './operations.ts';
import { resolveAccount } from './scoped.ts';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const DENIED = 'You do not have the privileges to administrate the users!';

export interface RoleRow {
	name: string;
	/** '' on MariaDB. */
	host: string;
	members: number;
}

export interface GrantedRole {
	role: string;
	host: string | null;
	adminOption: boolean;
	isDefault: boolean;
}

/** All role accounts with the number of accounts they are granted to. */
export async function listRoles(dbi: DatabaseInterface, server: PrivServer): Promise<RoleRow[]> {
	if (!supportsRoles(server)) return [];
	const roles = (await listAccounts(dbi, server)).filter((a) => a.isRole);
	const counts = new Map<string, number>();
	try {
		const rows = server.isMariaDB
			? await query(
					dbi,
					"SELECT `Role` AS u, '' AS h, COUNT(*) AS c FROM `mysql`.`roles_mapping` GROUP BY `Role`"
				)
			: await query(
					dbi,
					'SELECT `FROM_USER` AS u, `FROM_HOST` AS h, COUNT(*) AS c FROM `mysql`.`role_edges` GROUP BY `FROM_USER`, `FROM_HOST`'
				);
		for (const r of rows) counts.set(JSON.stringify([str(r.u), str(r.h)]), Number(r.c));
	} catch {
		// not readable
	}
	return roles.map((r) => ({
		name: r.user,
		host: r.host,
		members: counts.get(JSON.stringify([r.user, r.host])) ?? 0
	}));
}

/** Roles granted to an account (from SHOW GRANTS) with their default flag. */
export async function listGrantedRoles(
	dbi: DatabaseInterface,
	server: PrivServer,
	account: Account
): Promise<GrantedRole[]> {
	const acc = resolveAccount(server, account);
	const details = await readAccount(dbi, server, acc);
	const defaults = new Set<string>();
	try {
		if (server.isMariaDB) {
			const r = await query(
				dbi,
				'SELECT `default_role` AS d FROM `mysql`.`user` WHERE `User` = ? AND `Host` = ?',
				[acc.user, acc.host]
			);
			if (str(r[0]?.d) !== '') defaults.add(JSON.stringify([str(r[0]?.d), null]));
		} else {
			const r = await query(
				dbi,
				'SELECT `DEFAULT_ROLE_USER` AS u, `DEFAULT_ROLE_HOST` AS h FROM `mysql`.`default_roles` WHERE `USER` = ? AND `HOST` = ?',
				[acc.user, acc.host]
			);
			for (const x of r) defaults.add(JSON.stringify([str(x.u), str(x.h)]));
		}
	} catch {
		// not readable
	}
	return details.grants.roles.map((g) => ({
		role: g.role,
		host: g.host,
		adminOption: g.adminOption,
		isDefault: defaults.has(JSON.stringify([g.role, g.host]))
	}));
}

const validName = (n: string) => n.trim() !== '' && n.length <= 80 && !n.includes('\0');

export async function createRole(
	dbi: DatabaseInterface,
	server: PrivServer,
	caps: Pick<Capabilities, 'isCreateUser'>,
	name: string
): Promise<OperationResult> {
	if (!caps.isCreateUser) return { ok: false, error: DENIED, results: [] };
	if (!supportsRoles(server)) return { ok: false, error: 'Roles are not supported.', results: [] };
	if (!validName(name)) return { ok: false, error: 'The role name is empty!', results: [] };
	const results = await runStatements(dbi, [buildCreateRole(server, name)], true);
	return { ok: results.every((r) => r.ok), error: results.find((r) => !r.ok)?.error, results };
}

export async function dropRoles(
	dbi: DatabaseInterface,
	server: PrivServer,
	caps: Pick<Capabilities, 'isCreateUser'>,
	roles: { name: string; host: string }[]
): Promise<OperationResult> {
	if (!caps.isCreateUser) return { ok: false, error: DENIED, results: [] };
	if (roles.length === 0) return { ok: false, error: 'No roles selected.', results: [] };
	const results = await runStatements(
		dbi,
		roles.map((r) => buildDropRole(server, r.name, r.host || '%'))
	);
	return { ok: results.every((r) => r.ok), results };
}

export async function grantRoleTo(
	dbi: DatabaseInterface,
	server: PrivServer,
	caps: Pick<Capabilities, 'isGrantUser'>,
	input: { role: string; roleHost?: string; to: Account; adminOption: boolean }
): Promise<OperationResult> {
	if (!caps.isGrantUser) return { ok: false, error: DENIED, results: [] };
	if (!validName(input.role)) return { ok: false, error: 'No role selected.', results: [] };
	const to = resolveAccount(server, input.to);
	const results = await runStatements(
		dbi,
		[buildGrantRole(server, input.role, to, input.adminOption, input.roleHost || '%')],
		true
	);
	return { ok: results.every((r) => r.ok), error: results.find((r) => !r.ok)?.error, results };
}

export async function revokeRoleFrom(
	dbi: DatabaseInterface,
	server: PrivServer,
	caps: Pick<Capabilities, 'isGrantUser'>,
	input: { role: string; roleHost?: string; from: Account }
): Promise<OperationResult> {
	if (!caps.isGrantUser) return { ok: false, error: DENIED, results: [] };
	const from = resolveAccount(server, input.from);
	const results = await runStatements(
		dbi,
		[buildRevokeRole(server, input.role, from, input.roleHost || '%')],
		true
	);
	return { ok: results.every((r) => r.ok), error: results.find((r) => !r.ok)?.error, results };
}

export async function setDefaultRoles(
	dbi: DatabaseInterface,
	server: PrivServer,
	caps: Pick<Capabilities, 'isGrantUser'>,
	input: { account: Account; roles: { role: string; host: string | null }[] }
): Promise<OperationResult> {
	if (!caps.isGrantUser) return { ok: false, error: DENIED, results: [] };
	const account = resolveAccount(server, input.account);
	let stmt;
	try {
		if (input.roles.length === 0) stmt = buildSetDefaultRole(server, 'NONE', account);
		else if (server.isMariaDB) {
			stmt = buildSetDefaultRole(server, [input.roles[0].role], account);
			if (input.roles.length > 1) throw new Error('MariaDB takes exactly one default role.');
		} else {
			// roles share the host '%' unless the grant says otherwise; quote each with its own host
			stmt = buildSetDefaultRole(
				server,
				input.roles.map((r) => r.role),
				account
			);
		}
	} catch (e) {
		return { ok: false, error: (e as Error).message, results: [] };
	}
	const results = await runStatements(dbi, [stmt], true);
	return { ok: results.every((r) => r.ok), error: results.find((r) => !r.ok)?.error, results };
}
