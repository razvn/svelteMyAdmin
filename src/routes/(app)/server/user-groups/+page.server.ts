import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { menuTabs, TAB_LEVELS } from '#lib/nav/user-groups.ts';
import { withUserGroups } from '#lib/server/pmadb/user-groups.ts';
import { allTabKeys } from '#lib/nav/user-groups.ts';
import { getCapabilities } from '#lib/server/privileges/index.ts';
import type { Actions, PageServerLoad } from './$types';

const groupName = z.string().trim().min(1).max(64);

const levelTabs = TAB_LEVELS.map((level) => ({
	level,
	tabs: menuTabs(level).map((tab) => ({ key: tab.key, label: tab.label }))
}));

export const load: PageServerLoad = async ({ locals, url }) => {
	const dbi = await locals.dbi;
	const caps = await getCapabilities(dbi);
	const enabled = await withUserGroups(locals, (repo) => repo.ping());
	if (!enabled) return { state: 'disabled' as const, levelTabs };
	if (!caps.isSuperUser) return { state: 'no-privileges' as const, levelTabs };

	const view = await withUserGroups(locals, async (repo) => {
		const groups = await repo.listGroups();
		const usersOf = url.searchParams.get('users');
		const editName = url.searchParams.get('edit');
		const edit = editName ? groups.find((g) => g.name === editName) : undefined;
		return {
			groups: groups.map((g) => ({
				name: g.name,
				// A tab without a row counts as allowed (UserGroups::getAllowedTabNames)
				allowed: levelTabs.map((l) =>
					l.tabs.filter((tab) => g.tabs[tab.key] !== false).map((tab) => locals.i18n.t(tab.label))
				)
			})),
			members: usersOf ? { group: usersOf, users: await repo.listGroupUsers(usersOf) } : null,
			edit: edit
				? {
						name: edit.name,
						checked: levelTabs.flatMap((l) =>
							l.tabs.filter((tab) => edit.tabs[tab.key]).map((x) => x.key)
						)
					}
				: null
		};
	});
	if (!view) return { state: 'disabled' as const, levelTabs };
	return { state: 'ok' as const, levelTabs, adding: url.searchParams.has('add'), ...view };
};

function allowedKeys(fd: FormData): string[] {
	return levelTabs.flatMap((l) => l.tabs.map((tab) => tab.key)).filter((k) => fd.get(k) === 'Y');
}

async function isSuper(locals: App.Locals) {
	return (await getCapabilities(await locals.dbi)).isSuperUser;
}

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (!(await isSuper(locals))) return fail(403, { error: locals.i18n.t('No Privileges') });
		const fd = await request.formData();
		const isNew = fd.get('mode') === 'add';
		const name = groupName.safeParse(fd.get('userGroup'));
		if (!name.success) return fail(400, { error: locals.i18n.t('Group name is required.') });
		const res = await withUserGroups(locals, async (repo) => {
			const exists = await repo.groupExists(name.data);
			if (isNew && exists) return 'exists' as const;
			if (!isNew && !exists) return 'missing' as const;
			await repo.saveGroup(name.data, allowedKeys(fd), allTabKeys());
			return 'ok' as const;
		});
		if (res === undefined)
			return fail(500, { error: locals.i18n.t('User groups storage is unavailable.') });
		if (res === 'exists')
			return fail(400, { error: locals.i18n.t('This user group already exists.') });
		if (res === 'missing')
			return fail(404, { error: locals.i18n.t('This user group does not exist.') });
		return { saved: name.data };
	},

	delete: async ({ request, locals }) => {
		if (!(await isSuper(locals))) return fail(403, { error: locals.i18n.t('No Privileges') });
		const fd = await request.formData();
		const name = groupName.safeParse(fd.get('userGroup'));
		if (!name.success) return fail(400, { error: locals.i18n.t('Group name is required.') });
		const res = await withUserGroups(locals, async (repo) => {
			if (!(await repo.getGroup(name.data))) return false;
			await repo.deleteGroup(name.data);
			return true;
		});
		if (res === undefined)
			return fail(500, { error: locals.i18n.t('User groups storage is unavailable.') });
		if (!res) return fail(404, { error: locals.i18n.t('This user group does not exist.') });
		return { deleted: name.data };
	}
};
