/**
 * User groups in the configuration storage (`pma__users`, `pma__usergroups`), mirroring
 * ConfigStorage/UserGroups.php and Menu::getAllowedTabs. Functions take a connection and the
 * qualified table names so they run on the control connection (or any test connection).
 */
import { error } from '@sveltejs/kit';
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { withControl } from '#lib/server/table/control.ts';
import { currentTabPath, type TabContext, type TabLevel } from '#lib/nav/tabs.ts';
import { allTabKeys, isPathAllowed, TAB_LEVELS } from '#lib/nav/user-groups.ts';

export interface GroupTables {
	/** Qualified `pma__users`. */
	users: string;
	/** Qualified `pma__usergroups`. */
	groups: string;
}

/** Both tables must be configured (ConfigurableMenusFeature); null otherwise. */
export function groupTables(
	server: Pick<ServerConfig, 'pmadb' | 'users' | 'usergroups'>
): GroupTables | null {
	if (!server.pmadb || !server.users || !server.usergroups) return null;
	return {
		users: escapeQualified(server.pmadb, server.users),
		groups: escapeQualified(server.pmadb, server.usergroups)
	};
}

/** Run `fn` on the control connection with the group tables; undefined when unavailable. */
export async function withGroupTables<T>(
	locals: App.Locals,
	fn: (conn: Connection, tables: GroupTables) => Promise<T>
): Promise<T | undefined> {
	const tables = groupTables(locals.server);
	if (!tables) return undefined;
	return withControl(locals, (conn) => fn(conn, tables));
}

type Rows = Record<string, unknown>[];
async function select(conn: Connection, sql: string, params: unknown[] = []): Promise<Rows> {
	const [rows] = await conn.query(sql, params);
	return rows as Rows;
}

export interface UserGroup {
	name: string;
	/** tab key -> allowed */
	tabs: Record<string, boolean>;
}

/** All groups with their tab rows, ordered by name. */
export async function listGroups(conn: Connection, t: GroupTables): Promise<UserGroup[]> {
	const rows = await select(
		conn,
		`SELECT usergroup, tab, allowed FROM ${t.groups} ORDER BY usergroup`
	);
	const out = new Map<string, UserGroup>();
	for (const r of rows) {
		const name = String(r.usergroup);
		let g = out.get(name);
		if (!g) out.set(name, (g = { name, tabs: {} }));
		g.tabs[String(r.tab)] = String(r.allowed) === 'Y';
	}
	return [...out.values()];
}

export async function getGroup(
	conn: Connection,
	t: GroupTables,
	name: string
): Promise<UserGroup | null> {
	return (await listGroups(conn, t)).find((g) => g.name === name) ?? null;
}

/** DELETE + multi-row INSERT of one allowed row per known tab (UserGroups::edit). */
export async function saveGroup(
	conn: Connection,
	t: GroupTables,
	name: string,
	allowedKeys: readonly string[]
): Promise<void> {
	const allowed = new Set(allowedKeys);
	const keys = allTabKeys();
	await conn.query(`DELETE FROM ${t.groups} WHERE usergroup = ?`, [name]);
	const placeholders = keys.map(() => '(?, ?, ?)').join(', ');
	const params = keys.flatMap((k) => [name, k, allowed.has(k) ? 'Y' : 'N']);
	await conn.query(
		`INSERT INTO ${t.groups} (usergroup, tab, allowed) VALUES ${placeholders}`,
		params
	);
}

export async function groupExists(
	conn: Connection,
	t: GroupTables,
	name: string
): Promise<boolean> {
	const rows = await select(conn, `SELECT 1 FROM ${t.groups} WHERE usergroup = ? LIMIT 1`, [name]);
	return rows.length > 0;
}

/** Remove the group and its memberships (UserGroups::delete). */
export async function deleteGroup(conn: Connection, t: GroupTables, name: string): Promise<void> {
	await conn.query(`DELETE FROM ${t.users} WHERE usergroup = ?`, [name]);
	await conn.query(`DELETE FROM ${t.groups} WHERE usergroup = ?`, [name]);
}

export async function listGroupUsers(
	conn: Connection,
	t: GroupTables,
	name: string
): Promise<string[]> {
	const rows = await select(
		conn,
		`SELECT username FROM ${t.users} WHERE usergroup = ? ORDER BY username`,
		[name]
	);
	return rows.map((r) => String(r.username));
}

/** username -> group name, for the user accounts overview. */
export async function listMemberships(
	conn: Connection,
	t: GroupTables
): Promise<Record<string, string>> {
	const rows = await select(conn, `SELECT username, usergroup FROM ${t.users}`);
	return Object.fromEntries(rows.map((r) => [String(r.username), String(r.usergroup)]));
}

/** Assign a user to a group (or none): a user belongs to at most one group. */
export async function setUserGroup(
	conn: Connection,
	t: GroupTables,
	username: string,
	group: string | null
): Promise<void> {
	await conn.query(`DELETE FROM ${t.users} WHERE username = ?`, [username]);
	if (group) {
		await conn.query(`INSERT INTO ${t.users} (username, usergroup) VALUES (?, ?)`, [
			username,
			group
		]);
	}
}

/** Tab keys the user's group forbids (`allowed = 'N'`); empty without a group. */
export async function getDeniedTabKeys(
	conn: Connection,
	t: GroupTables,
	username: string
): Promise<string[]> {
	const rows = await select(
		conn,
		`SELECT tab FROM ${t.groups} WHERE allowed = 'N' AND usergroup IN ` +
			`(SELECT usergroup FROM ${t.users} WHERE username = ?)`,
		[username]
	);
	return rows
		.map((r) => String(r.tab))
		.filter((k) => TAB_LEVELS.some((l) => k.startsWith(`${l}_`)));
}

const cache = new WeakMap<object, Promise<string[]>>();

/** Denied tab keys of the logged-in user, looked up once per request on the control connection. */
export function getDeniedTabs(locals: App.Locals): Promise<string[]> {
	let p = cache.get(locals);
	if (!p) {
		const user = locals.session?.user;
		p = user
			? withGroupTables(locals, (conn, t) => getDeniedTabKeys(conn, t, user)).then((r) => r ?? [])
			: Promise.resolve([]);
		cache.set(locals, p);
	}
	return p;
}

/** Layout guard: 403 when the user's group forbids the page. Returns the denied keys. */
export async function guardTab(
	locals: App.Locals,
	level: TabLevel,
	ctx: TabContext,
	pathname: string
): Promise<string[]> {
	const denied = await getDeniedTabs(locals);
	const path = currentTabPath(level, ctx, pathname);
	if (path && !isPathAllowed(level, path, denied)) {
		error(403, locals.i18n.t('Your user group does not allow access to this page.'));
	}
	return denied;
}
