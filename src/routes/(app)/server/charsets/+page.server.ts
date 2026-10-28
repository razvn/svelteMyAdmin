import { listCharsetGroups } from '#lib/server/admin/charsets.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const conn = await locals.db;
	return { charsets: await listCharsetGroups(conn) };
};
