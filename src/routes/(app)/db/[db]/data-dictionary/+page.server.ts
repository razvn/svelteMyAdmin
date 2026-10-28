import { loadDataDictionary } from '#lib/server/database/data-dictionary.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const dbi = await locals.dbi;
	return { dictionary: await loadDataDictionary(dbi, locals.server, params.db) };
};
