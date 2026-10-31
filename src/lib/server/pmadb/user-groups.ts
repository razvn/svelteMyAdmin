/**
 * User groups in the configuration storage (`pma__users`, `pma__usergroups`), mirroring
 * ConfigStorage/UserGroups.php and Menu::getAllowedTabs. Functions take a connection and the
 * qualified table names so they run on the control connection (or any test connection).
 */
import { error } from '@sveltejs/kit';
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { currentTabPath, type TabContext, type TabLevel } from '#lib/nav/tabs.ts';
import { isPathAllowed, TAB_LEVELS } from '#lib/nav/user-groups.ts';
import { withRepo } from '#lib/server/storage/index.ts';
import { selectDeniedTabs, type GroupTables } from '#lib/server/storage/mysql/user-groups.ts';
import type { UserGroup, UserGroupsRepo } from '#lib/server/storage/types.ts';

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

/** Run `fn` with the user group repository; undefined when unavailable. */
export function withUserGroups<T>(
	locals: App.Locals,
	fn: (repo: UserGroupsRepo) => Promise<T>
): Promise<T | undefined> {
	return withRepo(locals, 'userGroups', fn);
}

export type { UserGroup };
export {
	deleteGroup,
	getGroup,
	groupExists,
	listGroups,
	listGroupUsers,
	listMemberships,
	saveGroup,
	setUserGroup,
	type GroupTables
} from '#lib/server/storage/mysql/user-groups.ts';

/** Tab keys the user's group forbids (`allowed = 'N'`); empty without a group. */
export async function getDeniedTabKeys(
	conn: Connection,
	t: GroupTables,
	username: string
): Promise<string[]> {
	return filterTabKeys(await selectDeniedTabs(conn, t, username));
}

const filterTabKeys = (keys: string[]) =>
	keys.filter((k) => TAB_LEVELS.some((l) => k.startsWith(`${l}_`)));

const cache = new WeakMap<object, Promise<string[]>>();

/** Denied tab keys of the logged-in user, looked up once per request on the control connection. */
export function getDeniedTabs(locals: App.Locals): Promise<string[]> {
	let p = cache.get(locals);
	if (!p) {
		const user = locals.session?.user;
		p = user
			? withUserGroups(locals, (repo) => repo.deniedTabKeys(user)).then((r) =>
					filterTabKeys(r ?? [])
				)
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
