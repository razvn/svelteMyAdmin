import { N_ } from '#lib/i18n/index.ts';
/**
 * Database / table / column / routine level privileges: object lists for the pickers, the update diff
 * (Privileges::updatePrivileges), revoke (getMessageAndSqlQueryForPrivilegesRevoke) and the "Users having
 * access to" listing of the Database and Table Privileges pages (Privileges::getAllPrivileges).
 */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import {
	accessEntries,
	buildColumnPrivilegeChanges,
	buildPrivilegeChanges,
	buildRevokeTarget,
	privilegesFor,
	unescapeWildcards,
	type Account,
	type AccessEntry,
	type ColumnPrivileges,
	type GrantTarget,
	type PrivServer,
	type Stmt
} from '#lib/sql/privileges/index.ts';
import { query, type Capabilities } from './context.ts';
import { listAccounts, readAccount, showGrantsLines, type AccountDetails } from './accounts.ts';
import { runStatements, type OperationResult } from './operations.ts';
import { parseShowGrants } from './show-grants.ts';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const sqlError = (e: unknown): string => {
	const err = e as { sqlMessage?: string; message?: string };
	return err.sqlMessage ?? err.message ?? String(e);
};
const DENIED = N_('You do not have the privileges to administrate the users!');

/** A MariaDB account with an empty host is a role: addressed without host. */
export function resolveAccount(server: PrivServer, account: Account): Account {
	return server.isMariaDB && account.host === '' ? { ...account, noHost: true } : account;
}

// ---- object lists ----

export async function listDatabaseNames(dbi: DatabaseInterface): Promise<string[]> {
	const rows = await query(
		dbi,
		'SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME'
	);
	return rows.map((r) => str(r.n));
}

export async function listTableNames(dbi: DatabaseInterface, db: string): Promise<string[]> {
	const rows = await query(
		dbi,
		'SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
		[unescapeWildcards(db)]
	);
	return rows.map((r) => str(r.n));
}

export async function listColumnNames(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<string[]> {
	const rows = await query(
		dbi,
		'SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
		[unescapeWildcards(db), table]
	);
	return rows.map((r) => str(r.n));
}

export interface RoutineRef {
	name: string;
	type: 'PROCEDURE' | 'FUNCTION';
}

export async function listRoutineNames(dbi: DatabaseInterface, db: string): Promise<RoutineRef[]> {
	const rows = await query(
		dbi,
		'SELECT ROUTINE_NAME AS n, ROUTINE_TYPE AS t FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME',
		[unescapeWildcards(db)]
	);
	return rows.map((r) => ({
		name: str(r.n),
		type: str(r.t).toUpperCase() === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE'
	}));
}

// ---- update / revoke ----

export const COLUMN_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] as const;

export interface ScopedUpdateInput {
	account: Account;
	target: Exclude<GrantTarget, { scope: 'global' }>;
	/** Privilege keywords of the grid. */
	privileges: string[];
	grantOption: boolean;
	/** Table targets only: column privileges (privilege -> columns). Omitted = leave column grants alone. */
	columns?: ColumnPrivileges;
}

/** Current privileges of `target` in the parsed grants of an account. */
export function currentFor(
	details: AccountDetails,
	target: ScopedUpdateInput['target']
): { privileges: string[]; grantOption: boolean; columns: ColumnPrivileges } {
	const g = details.grants;
	const none = { privileges: [], grantOption: false, columns: {} as ColumnPrivileges };
	if (target.scope === 'database') {
		const d = g.databases.find((x) => x.db === target.db);
		return d ? { ...none, privileges: d.privileges, grantOption: d.grantOption } : none;
	}
	if (target.scope === 'table') {
		const t = g.tables.find(
			(x) => unescapeWildcards(x.db) === unescapeWildcards(target.db) && x.table === target.table
		);
		if (!t) return none;
		const columns: ColumnPrivileges = {};
		for (const c of t.columns) columns[c.privilege] = c.columns;
		return { privileges: t.privileges, grantOption: t.grantOption, columns };
	}
	const r = g.routines.find(
		(x) =>
			unescapeWildcards(x.db) === unescapeWildcards(target.db) &&
			x.routine === target.routine &&
			x.type === target.type
	);
	return r ? { ...none, privileges: r.privileges, grantOption: r.grantOption } : none;
}

/** Statements that bring one target of an account to the requested privileges. */
export function planScopedUpdate(
	server: PrivServer,
	details: AccountDetails,
	input: ScopedUpdateInput
): Stmt[] {
	const cur = currentFor(details, input.target);
	const allowed = new Set(privilegesFor(input.target.scope, server).map((p) => p.name));
	const desired = [...new Set(input.privileges)].filter((n) => allowed.has(n));
	const stmts = buildPrivilegeChanges({
		account: input.account,
		target: input.target,
		current: cur.privileges,
		desired,
		currentGrantOption: cur.grantOption,
		grantOption: input.grantOption
	});
	if (input.target.scope === 'table' && input.columns) {
		const want: ColumnPrivileges = {};
		for (const name of COLUMN_PRIVILEGES) {
			const cols = [...new Set(input.columns[name] ?? [])].filter((c) => c !== '');
			// a column privilege that the table already has as a whole is redundant
			if (cols.length > 0 && !desired.includes(name)) want[name] = cols;
		}
		const have: ColumnPrivileges = {};
		for (const [k, v] of Object.entries(cur.columns)) {
			if ((COLUMN_PRIVILEGES as readonly string[]).includes(k)) have[k] = v;
		}
		stmts.push(...buildColumnPrivilegeChanges(input.account, input.target, have, want));
	}
	return stmts;
}

/** Edit privileges on a database / table / routine. */
export async function updateScopedPrivileges(
	dbi: DatabaseInterface,
	server: PrivServer,
	caps: Pick<Capabilities, 'isGrantUser'>,
	inputs: ScopedUpdateInput[]
): Promise<OperationResult> {
	if (!caps.isGrantUser) return { ok: false, error: DENIED, results: [] };
	const stmts: Stmt[] = [];
	try {
		for (const input of inputs) {
			const details = await readAccount(dbi, server, input.account);
			if (details.grantsError && !details.properties.exists) throw new Error(details.grantsError);
			stmts.push(...planScopedUpdate(server, details, input));
		}
	} catch (e) {
		return { ok: false, error: sqlError(e), results: [] };
	}
	const results = await runStatements(dbi, stmts);
	return { ok: results.every((r) => r.ok), results };
}

/** Revoke all privileges (and the grant option) on one target. */
export async function revokeScoped(
	dbi: DatabaseInterface,
	server: PrivServer,
	caps: Pick<Capabilities, 'isGrantUser'>,
	account: Account,
	target: Exclude<GrantTarget, { scope: 'global' }>
): Promise<OperationResult> {
	if (!caps.isGrantUser) return { ok: false, error: DENIED, results: [] };
	const cur = currentFor(await readAccount(dbi, server, account), target);
	const stmts = buildRevokeTarget(account, target, {
		privileges: cur.privileges.length > 0 || Object.keys(cur.columns).length > 0,
		grantOption: cur.grantOption
	});
	const results = await runStatements(dbi, stmts);
	return { ok: results.every((r) => r.ok), results };
}

// ---- users having access to a db / table ----

export interface AccessRow {
	user: string;
	host: string;
	noHost: boolean;
	entries: AccessEntry[];
}

/** Every account with grants that reach `db` (and `table`), from SHOW GRANTS of each account. */
export async function listUsersWithAccess(
	dbi: DatabaseInterface,
	server: PrivServer,
	db: string,
	table?: string
): Promise<AccessRow[]> {
	const out: AccessRow[] = [];
	for (const a of await listAccounts(dbi, server)) {
		const account = resolveAccount(server, a);
		let grants;
		try {
			grants = parseShowGrants(await showGrantsLines(dbi, account), server);
		} catch {
			continue;
		}
		const entries = accessEntries(grants, db, table);
		if (entries.length > 0) {
			out.push({ user: a.user, host: a.host, noHost: !!account.noHost, entries });
		}
	}
	return out;
}
