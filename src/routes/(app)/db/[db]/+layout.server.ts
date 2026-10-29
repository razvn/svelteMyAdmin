import { error } from '@sveltejs/kit';
import { guardTab } from '#lib/server/pmadb/user-groups.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals, url }) => {
	const deniedTabs = await guardTab(locals, 'db', { db: params.db }, url.pathname);
	const dbi = await locals.dbi;
	if (!(await dbi.databaseExists(params.db))) error(404, 'Database not found');
	return { db: params.db, deniedTabs };
};
