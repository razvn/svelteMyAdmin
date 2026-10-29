/**
 * Read accounts: the list for the overview (mysql.user plus the privilege tables, like
 * Privileges::getDbRightsForUserOverview / getUsersOverview) and one account for the edit page.
 */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import {
	quoteAccount,
	summarizePrivileges,
	type Account,
	type PrivilegeSummary,
	type PrivServer,
	type ResourceLimits,
	type SslRequirement
} from '#lib/sql/privileges/index.ts';
import { query } from './context.ts';
import { emptyGrants, parseShowGrants, type ParsedGrants } from './show-grants.ts';

export interface AccountRow extends Account {
	/** Row exists in mysql.user (otherwise the account only has database / table level grants). */
	inUserTable: boolean;
	hasPassword: boolean;
	plugin: string;
	locked: boolean;
	passwordExpired: boolean;
	isRole: boolean;
}

export interface OverviewAccount extends AccountRow {
	/** null when SHOW GRANTS failed for the account. */
	summary: PrivilegeSummary;
	hasGrant: boolean;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const key = (user: string, host: string) => JSON.stringify([user, host]);

/** Initial-letter filter (Privileges::rangeOfUsers): '' = anonymous users, else case insensitive prefix. */
export function matchesInitial(user: string, initial: string | null | undefined): boolean {
	if (initial === null || initial === undefined) return true;
	if (initial === '') return user === '';
	return user.toLowerCase().startsWith(initial.toLowerCase());
}

/** Distinct upper-cased first characters of the user names (`''` = anonymous), sorted like phpMyAdmin. */
export function initialsOf(users: readonly string[]): string[] {
	const set = new Set(users.map((u) => u.slice(0, 1).toUpperCase()));
	return [...set].sort((a, b) => {
		if (a === '') return -1;
		if (b === '') return 1;
		return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
	});
}

/** Rows of mysql.user (and global_priv lock flags on MariaDB) keyed by user and host. */
export async function readUserTable(
	dbi: DatabaseInterface,
	server: PrivServer
): Promise<Map<string, AccountRow & { raw: Record<string, unknown> }>> {
	const out = new Map<string, AccountRow & { raw: Record<string, unknown> }>();
	let rows: Record<string, unknown>[];
	try {
		rows = await query(dbi, 'SELECT * FROM `mysql`.`user`');
	} catch {
		return out;
	}
	const locked = new Set<string>();
	if (server.isMariaDB && server.version >= 100402) {
		try {
			const g = await query(
				dbi,
				'SELECT `User` AS u, `Host` AS h FROM `mysql`.`global_priv` ' +
					"WHERE JSON_VALUE(`Priv`, '$.account_locked') = 'true'"
			);
			for (const r of g) locked.add(key(str(r.u), str(r.h)));
		} catch {
			// no access to global_priv
		}
	}
	// MySQL 8 has no is_role column: roles are the targets of role_edges, or locked + expired + without credentials.
	const roleKeys = new Set<string>();
	if (!server.isMariaDB) {
		try {
			const e = await query(
				dbi,
				'SELECT DISTINCT `FROM_USER` AS u, `FROM_HOST` AS h FROM `mysql`.`role_edges`'
			);
			for (const r of e) roleKeys.add(key(str(r.u), str(r.h)));
		} catch {
			// no access / MySQL < 8
		}
	}
	for (const r of rows) {
		const user = str(r.User ?? r.user);
		const host = str(r.Host ?? r.host);
		out.set(key(user, host), {
			user,
			host,
			inUserTable: true,
			hasPassword: str(r.authentication_string) !== '' || str(r.Password) !== '',
			plugin: str(r.plugin),
			locked: str(r.account_locked).toUpperCase() === 'Y' || locked.has(key(user, host)),
			passwordExpired: str(r.password_expired).toUpperCase() === 'Y',
			isRole: server.isMariaDB
				? str(r.is_role).toUpperCase() === 'Y'
				: roleKeys.has(key(user, host)) ||
					(str(r.account_locked).toUpperCase() === 'Y' &&
						str(r.password_expired).toUpperCase() === 'Y' &&
						str(r.authentication_string) === ''),
			raw: r
		});
	}
	return out;
}

/** Every account that appears in mysql.user or one of the privilege tables, sorted by user and host. */
export async function listAccounts(
	dbi: DatabaseInterface,
	server: PrivServer
): Promise<AccountRow[]> {
	const users = await readUserTable(dbi, server);
	const seen = new Map<string, AccountRow>();
	for (const [k, v] of users) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { raw: _raw, ...row } = v;
		seen.set(k, row);
	}
	if (users.size > 0) {
		for (const table of ['db', 'tables_priv', 'columns_priv', 'procs_priv']) {
			try {
				const rows = await query(
					dbi,
					`SELECT DISTINCT \`User\` AS u, \`Host\` AS h FROM \`mysql\`.\`${table}\``
				);
				for (const r of rows) {
					const user = str(r.u);
					const host = str(r.h);
					if (!seen.has(key(user, host))) {
						seen.set(key(user, host), {
							user,
							host,
							inUserTable: false,
							hasPassword: false,
							plugin: '',
							locked: false,
							passwordExpired: false,
							isRole: false
						});
					}
				}
			} catch {
				// table not readable / missing
			}
		}
	}
	return [...seen.values()].sort(
		(a, b) => a.user.localeCompare(b.user, 'en') || a.host.localeCompare(b.host, 'en')
	);
}

/** Rows of `SHOW GRANTS FOR account`. Throws when the account has no grants or cannot be shown. */
export async function showGrantsLines(dbi: DatabaseInterface, account: Account): Promise<string[]> {
	const rows = await query(dbi, `SHOW GRANTS FOR ${quoteAccount(account)}`);
	return rows.map((r) => String(Object.values(r)[0]));
}

/** Attach the global privilege summary and the grant flag to accounts (one SHOW GRANTS each). */
export async function withPrivilegeSummaries(
	dbi: DatabaseInterface,
	server: PrivServer,
	accounts: readonly AccountRow[]
): Promise<OverviewAccount[]> {
	const out: OverviewAccount[] = [];
	for (const a of accounts) {
		let grants: ParsedGrants = emptyGrants();
		try {
			grants = parseShowGrants(await showGrantsLines(dbi, a), server);
		} catch {
			// no grants / not allowed: shown as USAGE
		}
		out.push({
			...a,
			summary: summarizePrivileges(grants.global.privileges, 'global', server),
			hasGrant: grants.global.grantOption
		});
	}
	return out;
}

export interface AccountProperties {
	exists: boolean;
	plugin: string;
	hasPassword: boolean;
	locked: boolean;
	passwordExpired: boolean;
	ssl: SslRequirement;
	limits: ResourceLimits;
}

const DEFAULT_PROPS: AccountProperties = {
	exists: false,
	plugin: '',
	hasPassword: false,
	locked: false,
	passwordExpired: false,
	ssl: { type: 'NONE' },
	limits: { maxQuestions: 0, maxConnections: 0, maxUpdates: 0, maxUserConnections: 0 }
};

/** Account facts from the `mysql.user` row: plugin, password, locking, REQUIRE and MAX_* values. */
export async function readAccountProperties(
	dbi: DatabaseInterface,
	server: PrivServer,
	account: Account
): Promise<AccountProperties> {
	const users = await readUserTable(dbi, server);
	const row = users.get(key(account.user, account.host));
	if (!row)
		return { ...DEFAULT_PROPS, ssl: { ...DEFAULT_PROPS.ssl }, limits: { ...DEFAULT_PROPS.limits } };
	const r = row.raw;
	const sslType = str(r.ssl_type).toUpperCase();
	const ssl: SslRequirement =
		sslType === 'ANY' || sslType === 'X509' || sslType === 'SPECIFIED'
			? {
					type: sslType,
					cipher: str(r.ssl_cipher),
					issuer: str(r.x509_issuer),
					subject: str(r.x509_subject)
				}
			: { type: 'NONE' };
	return {
		exists: true,
		plugin: row.plugin,
		hasPassword: row.hasPassword,
		locked: row.locked,
		passwordExpired: row.passwordExpired,
		ssl,
		limits: {
			maxQuestions: Number(r.max_questions ?? 0),
			maxConnections: Number(r.max_connections ?? 0),
			maxUpdates: Number(r.max_updates ?? 0),
			maxUserConnections: Number(r.max_user_connections ?? 0)
		}
	};
}

export interface AccountDetails {
	account: Account;
	properties: AccountProperties;
	grants: ParsedGrants;
	/** Set when SHOW GRANTS failed (account without grants, or no permission). */
	grantsError: string | null;
}

/** Everything the edit page needs about one account. */
export async function readAccount(
	dbi: DatabaseInterface,
	server: PrivServer,
	account: Account
): Promise<AccountDetails> {
	const properties = await readAccountProperties(dbi, server, account);
	let grants = emptyGrants();
	let grantsError: string | null = null;
	try {
		grants = parseShowGrants(await showGrantsLines(dbi, account), server);
		// MariaDB prints REQUIRE / limits on the global line: prefer it when mysql.user was unreadable.
		if (!properties.exists) {
			if (grants.tail.ssl) properties.ssl = { ...properties.ssl, ...grants.tail.ssl };
			if (grants.tail.limits) properties.limits = { ...properties.limits, ...grants.tail.limits };
		}
	} catch (e) {
		grantsError = (e as { sqlMessage?: string }).sqlMessage ?? (e as Error).message;
	}
	return { account, properties, grants, grantsError };
}

export interface AccountCredentials {
	plugin: string;
	/** `authentication_string` (or the legacy `Password`), '' = none. */
	hash: string;
}

/** The stored credential of an account, to recreate it under another name. */
export async function readAccountCredentials(
	dbi: DatabaseInterface,
	server: PrivServer,
	account: Account
): Promise<AccountCredentials> {
	const row = (await readUserTable(dbi, server)).get(key(account.user, account.host));
	if (!row) return { plugin: '', hash: '' };
	return {
		plugin: row.plugin,
		hash: str(row.raw.authentication_string) || str(row.raw.Password)
	};
}

/**
 * The authentication plugin of an account: from mysql.user, else (for the current user without access to the
 * mysql schema) from `SHOW CREATE USER`.
 */
export async function getAccountPlugin(
	dbi: DatabaseInterface,
	server: PrivServer,
	account: Account
): Promise<string> {
	const props = await readAccountProperties(dbi, server, account).catch(() => null);
	if (props?.exists) return props.plugin;
	try {
		const rows = await query(dbi, `SHOW CREATE USER ${quoteAccount(account)}`);
		const text = String(Object.values(rows[0] ?? {})[0] ?? '');
		const my = /IDENTIFIED WITH '?([A-Za-z0-9_]+)'?/.exec(text);
		if (my) return my[1];
		const ma = /IDENTIFIED VIA ([A-Za-z0-9_]+)/.exec(text);
		if (ma) return ma[1];
		if (/IDENTIFIED BY PASSWORD/.test(text)) return 'mysql_native_password';
	} catch {
		// not allowed
	}
	return '';
}
