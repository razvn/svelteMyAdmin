import { loadAccessView } from '#lib/server/privileges/index.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	return loadAccessView(await locals.dbi, params.db);
};
