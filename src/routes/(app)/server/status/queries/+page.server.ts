import { queryStats, usedQueries } from '#lib/admin/queries.ts';
import { getStatusData } from '#lib/server/admin/status.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { status } = await getStatusData(await locals.db);
	return { stats: queryStats(usedQueries(status), Number(status.Uptime ?? 0)) };
};
