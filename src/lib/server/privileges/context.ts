/**
 * Server facts the privilege pages need: the PrivServer, what the current user may do
 * (DatabaseInterface::isSuperUser / isGrantUser / isCreateUser) and the installed authentication plugins.
 */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { parseAccountString, type Account, type PrivServer } from '#lib/sql/privileges/index.ts';

type Row = Record<string, unknown>;

export async function query(
	dbi: DatabaseInterface,
	sql: string,
	params: unknown[] = []
): Promise<Row[]> {
	const [rows] = await dbi.conn.query(sql, params);
	return Array.isArray(rows) ? (rows as Row[]) : [];
}

/** `5.5.5-10.11.6-MariaDB` -> 101106, `11.4.13-MariaDB-ubu2404` -> 110413, `8.4.13` -> 80413. */
export function parseServerVersion(version: string): number {
	const m = /^5\.5\.5-(\d+\.\d+\.\d+)/.exec(version) ?? /^(\d+\.\d+\.\d+)/.exec(version);
	if (!m) return 0;
	const [a, b, c] = m[1].split('.').map(Number);
	return a * 10000 + b * 100 + c;
}

export async function getPrivServer(dbi: DatabaseInterface): Promise<PrivServer> {
	const info = await dbi.getServerInfo();
	return { isMariaDB: info.serverType === 'MariaDB', version: parseServerVersion(info.version) };
}

export interface Capabilities {
	/** Can read `mysql.user` (phpMyAdmin's "super user" test). */
	isSuperUser: boolean;
	isCreateUser: boolean;
	isGrantUser: boolean;
	/** RELOAD (or FLUSH_PRIVILEGES): can run FLUSH PRIVILEGES. */
	canReload: boolean;
	/** CURRENT_USER() of the connection. */
	currentUser: Account;
}

export async function getCurrentAccount(dbi: DatabaseInterface): Promise<Account> {
	const [r] = await query(dbi, 'SELECT CURRENT_USER() AS u');
	return parseAccountString(String(r?.u ?? ''));
}

/**
 * What the connected user may do. Like phpMyAdmin the answer comes from information_schema.USER_PRIVILEGES
 * (own grants are always visible): CREATE USER makes an "create user", any grantable privilege a "grant user".
 */
export async function getCapabilities(dbi: DatabaseInterface): Promise<Capabilities> {
	const currentUser = await getCurrentAccount(dbi);
	let isSuperUser: boolean;
	try {
		isSuperUser = (await query(dbi, 'SELECT 1 FROM mysql.user LIMIT 1')).length > 0;
	} catch {
		isSuperUser = false;
	}
	let isCreateUser = false;
	let isGrantUser = false;
	let canReload = false;
	try {
		// information_schema prints the grantee as 'user'@'host' without escaping quotes
		const rows = await query(
			dbi,
			'SELECT PRIVILEGE_TYPE AS p, IS_GRANTABLE AS g FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?',
			[`'${currentUser.user}'@'${currentUser.host}'`]
		);
		isCreateUser = rows.some((r) => String(r.p).toUpperCase() === 'CREATE USER');
		isGrantUser = rows.some((r) => String(r.g).toUpperCase() === 'YES');
		canReload = rows.some((r) =>
			['RELOAD', 'FLUSH_PRIVILEGES'].includes(String(r.p).toUpperCase())
		);
	} catch {
		// information_schema unavailable: stay conservative
	}
	return { isSuperUser, isCreateUser, isGrantUser, canReload, currentUser };
}

export interface ActivePlugin {
	name: string;
	description: string;
}

/** AUTHENTICATION plugins whose status is ACTIVE (a disabled `mysql_native_password` on MySQL 8.4 is skipped). */
export async function listActiveAuthPlugins(dbi: DatabaseInterface): Promise<ActivePlugin[]> {
	try {
		const rows = await query(
			dbi,
			'SELECT PLUGIN_NAME AS n, PLUGIN_DESCRIPTION AS d FROM information_schema.PLUGINS ' +
				"WHERE PLUGIN_TYPE = 'AUTHENTICATION' AND PLUGIN_STATUS = 'ACTIVE' ORDER BY PLUGIN_NAME"
		);
		return rows.map((r) => ({ name: String(r.n), description: String(r.d ?? '') }));
	} catch {
		return [];
	}
}

/** Max lengths of mysql.user.User / Host (Privileges::getUsernameAndHostnameLength). */
export async function getAccountNameLengths(
	dbi: DatabaseInterface
): Promise<{ user: number; host: number }> {
	const out = { user: 80, host: 255 };
	try {
		const rows = await query(
			dbi,
			'SELECT COLUMN_NAME AS c, CHARACTER_MAXIMUM_LENGTH AS l FROM information_schema.COLUMNS ' +
				"WHERE TABLE_SCHEMA = 'mysql' AND TABLE_NAME = 'user' AND COLUMN_NAME IN ('User', 'Host')"
		);
		for (const r of rows) {
			const len = Number(r.l);
			if (!Number.isFinite(len) || len <= 0) continue;
			if (r.c === 'User') out.user = len;
			if (r.c === 'Host') out.host = len;
		}
	} catch {
		// keep the fallback
	}
	return out;
}

/** Host part of USER() (the host the connection comes from), for the "This host" option. */
export async function getThisHost(dbi: DatabaseInterface): Promise<string> {
	const [r] = await query(dbi, 'SELECT USER() AS u');
	return parseAccountString(String(r?.u ?? '')).host;
}
