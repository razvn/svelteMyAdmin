import { groupPluginsByType, listPlugins } from '#lib/server/admin/plugins.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const conn = await locals.db;
	return { groups: groupPluginsByType(await listPlugins(conn)) };
};
