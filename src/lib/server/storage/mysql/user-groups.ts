/** MySQL `pma__users` + `pma__usergroups` (ConfigStorage/UserGroups.php). */
import type { Connection } from 'mysql2/promise';
import { allTabKeys } from '#lib/nav/user-groups.ts';
import type { UserGroup, UserGroupsRepo } from '../types.ts';
import { pinger, type Run } from './runner.ts';

export interface GroupTables {
	/** Qualified `pma__users`. */
	users: string;
	/** Qualified `pma__usergroups`. */
	groups: string;
}

type Rows = Record<string, unknown>[];
async function select(conn: Connection, sql: string, params: unknown[] = []): Promise<Rows> {
	const [rows] = await conn.query(sql, params);
	return rows as Rows;
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
	allowedKeys: readonly string[],
	keys: readonly string[] = allTabKeys()
): Promise<void> {
	const allowed = new Set(allowedKeys);
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

/** Raw tab keys the user's group forbids (`allowed = 'N'`). */
export async function selectDeniedTabs(
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
	return rows.map((r) => String(r.tab));
}

export const userGroupsRepo = (run: Run, t: GroupTables): UserGroupsRepo => ({
	async ping() {
		return (await pinger(run, t.users)()) && (await pinger(run, t.groups)());
	},
	listGroups: () => run((c) => listGroups(c, t)),
	getGroup: (name) => run((c) => getGroup(c, t, name)),
	saveGroup: (name, allowed, keys) => run((c) => saveGroup(c, t, name, allowed, keys)),
	groupExists: (name) => run((c) => groupExists(c, t, name)),
	deleteGroup: (name) => run((c) => deleteGroup(c, t, name)),
	listGroupUsers: (name) => run((c) => listGroupUsers(c, t, name)),
	listMemberships: () => run((c) => listMemberships(c, t)),
	setUserGroup: (username, group) => run((c) => setUserGroup(c, t, username, group)),
	deniedTabKeys: (username) => run((c) => selectDeniedTabs(c, t, username))
});
