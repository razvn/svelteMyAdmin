import { listEngines } from '#lib/server/admin/engines.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const conn = await locals.db;
	return { engines: await listEngines(conn) };
};
