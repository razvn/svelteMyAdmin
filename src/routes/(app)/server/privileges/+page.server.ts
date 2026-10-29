import { fail } from '@sveltejs/kit';
import {
	decodeAccount,
	dropAccounts,
	encodeAccount,
	exportGrants,
	getCapabilities,
	getPrivServer,
	initialsOf,
	listAccounts,
	matchesInitial,
	parseSelectedAccounts,
	withPrivilegeSummaries
} from '#lib/server/privileges/index.ts';
import {
	listGroups,
	listMemberships,
	setUserGroup,
	withGroupTables
} from '#lib/server/pmadb/user-groups.ts';
import { buildFlushPrivileges } from '#lib/sql/privileges/index.ts';
import type { Actions, PageServerLoad } from './$types';

/** phpMyAdmin lists accounts directly only below this many users, else an initial must be chosen. */
const LIST_LIMIT = 50;
/** Show the initials row from this many accounts on. */
const INITIALS_FROM = 20;

export const load: PageServerLoad = async ({ locals, url }) => {
	const dbi = await locals.dbi;
	const [server, caps] = await Promise.all([getPrivServer(dbi), getCapabilities(dbi)]);
	const base = {
		caps: {
			isSuperUser: caps.isSuperUser,
			isCreateUser: caps.isCreateUser,
			isGrantUser: caps.isGrantUser,
			canReload: caps.canReload
		},
		server
	};
	if (!caps.isSuperUser && !caps.isGrantUser && !caps.isCreateUser) {
		return { ...base, state: 'no-privileges' as const };
	}
	if (!caps.isSuperUser) {
		return { ...base, state: 'cannot-view' as const };
	}

	// User groups (configurable menus) are optional: only when both pmadb tables answer.
	const groupInfo = await withGroupTables(locals, async (conn, t) => ({
		memberships: await listMemberships(conn, t),
		groups: (await listGroups(conn, t)).map((g) => g.name)
	}));
	const memberships = groupInfo?.memberships ?? {};

	const all = (await listAccounts(dbi, server)).filter((a) => !a.isRole);
	const initialParam = url.searchParams.get('initial');
	const showAll = url.searchParams.has('showall');
	const filtered = all.filter((a) => matchesInitial(a.user, initialParam));
	const tooMany = initialParam === null && !showAll && filtered.length >= LIST_LIMIT;
	const accounts = tooMany ? [] : await withPrivilegeSummaries(dbi, server, filtered);

	return {
		...base,
		state: 'ok' as const,
		total: all.length,
		initials: all.length > INITIALS_FROM ? initialsOf(all.map((a) => a.user)) : [],
		initial: initialParam,
		showAll,
		tooMany,
		anonymousLocalhost: all.some((a) => a.user === '' && a.host === 'localhost'),
		hasAccountLocking: all.some((a) => a.locked),
		currentUser: caps.currentUser,
		userGroups: groupInfo ? { groups: groupInfo.groups } : null,
		accounts: accounts.map((a) => ({
			value: encodeAccount(a),
			user: a.user,
			host: a.host,
			hasPassword: a.hasPassword,
			inUserTable: a.inUserTable,
			locked: a.locked,
			summary: a.summary,
			hasGrant: a.hasGrant,
			userGroup: memberships[a.user] ?? ''
		}))
	};
};

export const actions: Actions = {
	drop: async ({ request, locals }) => {
		const fd = await request.formData();
		const dbi = await locals.dbi;
		const caps = await getCapabilities(dbi);
		const res = await dropAccounts(dbi, caps, {
			accounts: parseSelectedAccounts(fd),
			dropDatabases: fd.get('drop_users_db') === 'on'
		});
		if (!res.ok) return fail(400, { drop: res });
		return { drop: res };
	},

	export: async ({ request, locals }) => {
		const fd = await request.formData();
		const dbi = await locals.dbi;
		const caps = await getCapabilities(dbi);
		if (!caps.isSuperUser) {
			return fail(403, {
				exportError: 'You do not have the privileges to administrate the users!'
			});
		}
		const only = fd.get('only');
		const one = typeof only === 'string' ? decodeAccount(only) : null;
		const accounts = one ? [one] : parseSelectedAccounts(fd);
		if (accounts.length === 0) return fail(400, { exportError: 'No users selected.' });
		return { exportText: await exportGrants(dbi, accounts) };
	},

	setGroup: async ({ request, locals }) => {
		const dbi = await locals.dbi;
		const caps = await getCapabilities(dbi);
		if (!caps.isSuperUser) {
			return fail(403, { groupError: 'You do not have the privileges to administrate the users!' });
		}
		const fd = await request.formData();
		const username = String(fd.get('username') ?? '');
		const group = String(fd.get('usergroup') ?? '');
		if (username === '') return fail(400, { groupError: 'Missing parameter: username' });
		const res = await withGroupTables(locals, async (conn, t) => {
			if (group !== '' && !(await listGroups(conn, t)).some((g) => g.name === group)) return false;
			await setUserGroup(conn, t, username, group === '' ? null : group);
			return true;
		});
		if (res === undefined)
			return fail(400, { groupError: 'User groups management is not enabled.' });
		if (!res) return fail(400, { groupError: 'This user group does not exist.' });
		return { groupSet: { username, group } };
	},

	flush: async ({ locals }) => {
		const dbi = await locals.dbi;
		const caps = await getCapabilities(dbi);
		if (!caps.canReload) {
			return fail(403, { flushError: 'You do not have the RELOAD privilege.' });
		}
		try {
			await dbi.conn.query(buildFlushPrivileges().sql);
		} catch (e) {
			return fail(500, {
				flushError: (e as { sqlMessage?: string }).sqlMessage ?? 'FLUSH PRIVILEGES failed.'
			});
		}
		return { flushed: true };
	}
};
