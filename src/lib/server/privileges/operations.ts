import type { Translator } from '#lib/i18n/translator.ts';
import { N_ } from '#lib/i18n/index.ts';
/**
 * Account operations: add, update global privileges, drop, export and change the own password.
 * They build the statements with `#lib/sql/privileges`, run them one by one and report every statement with its
 * outcome (passwords are masked in the reported text).
 */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import {
	buildAlterUserOptions,
	buildChangePassword,
	buildCreateUser,
	buildDatabaseGrants,
	buildDropDatabase,
	buildDropUser,
	buildFlushPrivileges,
	buildGrant,
	buildPrivilegeChanges,
	findPrivilege,
	privilegesFor,
	quoteAccount,
	supportsAlterUserOptions,
	type Account,
	type DatabaseGrantChoice,
	type PrivServer,
	type ResourceLimits,
	type SslRequirement,
	type Stmt
} from '#lib/sql/privileges/index.ts';
import { query, type Capabilities } from './context.ts';
import { getAccountPlugin, readAccount, showGrantsLines } from './accounts.ts';

export interface StatementResult {
	/** The statement as shown to the user (secrets masked). */
	statement: string;
	ok: boolean;
	error?: string;
}

export interface OperationResult {
	ok: boolean;
	/** Top level error (validation, "user exists", ...), when nothing was run. English msgid or a MySQL message. */
	error?: string;
	/** `{params}` of `error`. */
	errorParams?: Record<string, string | number>;
	results: StatementResult[];
}

/** Translated top-level error of an operation/validation result (MySQL messages pass through unchanged). */
export function errorText(
	res: { error?: string | null; errorParams?: Record<string, string | number> },
	i18n: Translator
): string | null {
	return res.error ? i18n.t(res.error, res.errorParams) : null;
}

const sqlError = (e: unknown): string => {
	const err = e as { sqlMessage?: string; message?: string };
	return err.sqlMessage ?? err.message ?? String(e);
};

/** Run statements in order; stops at the first failure when `stopOnError`. */
export async function runStatements(
	dbi: DatabaseInterface,
	stmts: readonly Stmt[],
	stopOnError = false
): Promise<StatementResult[]> {
	const results: StatementResult[] = [];
	for (const s of stmts) {
		try {
			await dbi.conn.query(s.sql);
			results.push({ statement: s.display, ok: true });
		} catch (e) {
			results.push({ statement: s.display, ok: false, error: sqlError(e) });
			if (stopOnError) break;
		}
	}
	return results;
}

const failed = (results: StatementResult[]) => results.some((r) => !r.ok);

export async function accountExists(dbi: DatabaseInterface, account: Account): Promise<boolean> {
	const rows = await query(
		dbi,
		'SELECT 1 AS x FROM `mysql`.`user` WHERE `User` = ? AND `Host` = ? LIMIT 1',
		[account.user, account.host]
	);
	return rows.length > 0;
}

export interface NewAccountInput {
	account: Account;
	plugin?: string;
	/** Clear text password, '' = none. */
	password: string;
	/** Global privilege keywords (validated against the catalogue). */
	privileges: string[];
	grantOption: boolean;
	ssl: SslRequirement;
	limits: ResourceLimits;
	databases: DatabaseGrantChoice;
}

/** Keep only privileges that the catalogue offers at global level on this server. */
export function sanitizeGlobalPrivileges(names: readonly string[], server: PrivServer): string[] {
	const allowed = new Set(privilegesFor('global', server).map((p) => p.name));
	return [...new Set(names)].filter((n) => allowed.has(n));
}

/** Add user account: CREATE USER, global GRANT, then the "Database for user account" statements. */
export async function createAccount(
	dbi: DatabaseInterface,
	server: PrivServer,
	caps: Pick<Capabilities, 'isCreateUser' | 'isGrantUser'>,
	input: NewAccountInput
): Promise<OperationResult> {
	if (!caps.isCreateUser) {
		return {
			ok: false,
			error: N_('You do not have the privileges to administrate the users!'),
			results: []
		};
	}
	if (await accountExists(dbi, input.account)) {
		return {
			ok: false,
			error: `The user ${quoteAccount(input.account)} already exists!`,
			results: []
		};
	}
	const embed = supportsAlterUserOptions(server);
	const stmts: Stmt[] = [
		buildCreateUser(server, {
			account: input.account,
			plugin: input.plugin,
			password: input.password,
			...(embed ? { ssl: input.ssl, limits: input.limits } : {})
		})
	];
	const first = await runStatements(dbi, stmts, true);
	if (failed(first)) return { ok: false, error: first[0].error, results: first };

	const rest: Stmt[] = [];
	if (!embed) {
		const alter = buildAlterUserOptions(server, input.account, {
			ssl: input.ssl.type === 'NONE' ? undefined : input.ssl,
			limits: input.limits
		});
		if (alter) rest.push(alter);
	}
	const privileges = sanitizeGlobalPrivileges(input.privileges, server);
	if (caps.isGrantUser && (privileges.length > 0 || input.grantOption)) {
		rest.push(
			buildGrant({
				account: input.account,
				target: { scope: 'global' },
				privileges,
				grantOption: input.grantOption
			})
		);
	}
	if (caps.isGrantUser) rest.push(...buildDatabaseGrants(input.account, input.databases));
	const results = [...first, ...(await runStatements(dbi, rest))];
	return { ok: !failed(results), results };
}

export interface GlobalUpdateInput {
	account: Account;
	privileges: string[];
	grantOption: boolean;
	ssl: SslRequirement;
	limits: ResourceLimits;
}

const sameSsl = (a: SslRequirement, b: SslRequirement) =>
	a.type === b.type &&
	(a.type !== 'SPECIFIED' ||
		((a.cipher ?? '') === (b.cipher ?? '') &&
			(a.issuer ?? '') === (b.issuer ?? '') &&
			(a.subject ?? '') === (b.subject ?? '')));

/** Statements to bring an account's global privileges, REQUIRE and limits to the requested state. */
export async function planGlobalUpdate(
	dbi: DatabaseInterface,
	server: PrivServer,
	input: GlobalUpdateInput
): Promise<Stmt[]> {
	const details = await readAccount(dbi, server, input.account);
	if (details.grantsError && !details.properties.exists) {
		throw new Error(details.grantsError);
	}
	const catalogue = new Set(privilegesFor('global', server).map((p) => p.name));
	const current = details.grants.global.privileges;
	// Privileges the grid cannot show (unknown / other flavour) stay as they are.
	const keep = current.filter((p) => !catalogue.has(p) && !findPrivilege(p));
	const desired = [...sanitizeGlobalPrivileges(input.privileges, server), ...keep];
	const stmts = buildPrivilegeChanges({
		account: input.account,
		target: { scope: 'global' },
		current,
		desired,
		currentGrantOption: details.grants.global.grantOption,
		grantOption: input.grantOption
	});

	const props = details.properties;
	const limitKeys = (Object.keys(input.limits) as (keyof ResourceLimits)[]).filter(
		(k) => Math.max(0, Math.floor(input.limits[k])) !== props.limits[k]
	);
	const sslChanged = !sameSsl(input.ssl, props.ssl);
	const alter = buildAlterUserOptions(server, input.account, {
		ssl: sslChanged ? input.ssl : undefined,
		limits: limitKeys.length ? input.limits : undefined,
		limitKeys
	});
	if (alter) stmts.push(alter);
	return stmts;
}

/** Edit privileges (Global tab): run the diff. */
export async function updateGlobalPrivileges(
	dbi: DatabaseInterface,
	server: PrivServer,
	caps: Pick<Capabilities, 'isGrantUser'>,
	input: GlobalUpdateInput
): Promise<OperationResult> {
	if (!caps.isGrantUser) {
		return {
			ok: false,
			error: N_('You do not have the privileges to administrate the users!'),
			results: []
		};
	}
	let stmts: Stmt[];
	try {
		stmts = await planGlobalUpdate(dbi, server, input);
	} catch (e) {
		return { ok: false, error: sqlError(e), results: [] };
	}
	const results = await runStatements(dbi, stmts);
	return { ok: !failed(results), results };
}

const SYSTEM_SCHEMAS = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);

export interface DropInput {
	accounts: Account[];
	/** Also `DROP DATABASE IF EXISTS` for the databases named like the users. */
	dropDatabases: boolean;
}

/** Remove selected user accounts (never the connected one, never system schemas). */
export async function dropAccounts(
	dbi: DatabaseInterface,
	caps: Pick<Capabilities, 'isCreateUser' | 'currentUser'>,
	input: DropInput
): Promise<OperationResult> {
	if (!caps.isCreateUser) {
		return {
			ok: false,
			error: N_('You do not have the privileges to administrate the users!'),
			results: []
		};
	}
	if (input.accounts.length === 0)
		return { ok: false, error: N_('No users selected for deleting!'), results: [] };
	const results: StatementResult[] = [];
	for (const a of input.accounts) {
		if (a.user === caps.currentUser.user && a.host === caps.currentUser.host) {
			results.push({
				statement: `DROP USER ${quoteAccount(a)}`,
				ok: false,
				error: N_('You cannot delete the account you are logged in with.')
			});
			continue;
		}
		results.push(...(await runStatements(dbi, [buildDropUser(a)])));
		if (input.dropDatabases && a.user !== '') {
			if (SYSTEM_SCHEMAS.has(a.user.toLowerCase())) {
				results.push({
					statement: buildDropDatabase(a.user).sql,
					ok: false,
					error: `${a.user} is a system schema and is not dropped.`
				});
			} else {
				results.push(...(await runStatements(dbi, [buildDropDatabase(a.user)])));
			}
		}
	}
	return { ok: !failed(results), results };
}

/** Text of the "Export" dialog: `# Privileges for ...` and the SHOW GRANTS rows of each account. */
export async function exportGrants(
	dbi: DatabaseInterface,
	accounts: readonly Account[]
): Promise<string> {
	const seen = new Set<string>();
	const blocks: string[] = [];
	for (const a of accounts) {
		const k = JSON.stringify([a.user, a.host]);
		if (seen.has(k)) continue;
		seen.add(k);
		let body: string;
		try {
			body = (await showGrantsLines(dbi, a)).map((l) => l + ';').join('\n\n');
		} catch (e) {
			body = `-- ${sqlError(e)}`;
		}
		blocks.push(`# Privileges for \`${a.user}\`@\`${a.host}\`\n\n${body}`);
	}
	return blocks.join('\n\n\n');
}

export interface PasswordChangeInput {
	account: Account;
	password: string;
	/** Chosen hashing / authentication plugin (optional). */
	plugin?: string;
}

/** Change the password of `account` (the connected user on the Change password page). */
export async function changePassword(
	dbi: DatabaseInterface,
	server: PrivServer,
	input: PasswordChangeInput
): Promise<OperationResult> {
	const currentPlugin = await getAccountPlugin(dbi, server, input.account);
	const stmt = buildChangePassword(server, {
		account: input.account,
		password: input.password,
		plugin: input.plugin || undefined,
		currentPlugin: currentPlugin || undefined
	});
	const results = await runStatements(dbi, [stmt], true);
	if (failed(results)) return { ok: false, error: results[0].error, results };
	// Flush after a successful password change (as phpMyAdmin does); not required, never fatal.
	await dbi.conn.query(buildFlushPrivileges().sql).catch(() => {});
	return { ok: true, results };
}
