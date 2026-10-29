import { getAdvisorResult } from '#lib/server/admin/advisor.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return { advisor: await getAdvisorResult(await locals.db, locals.server.host, locals.i18n) };
};
