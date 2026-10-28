import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	const dbi = await locals.dbi;
	if (!(await dbi.databaseExists(params.db))) error(404, 'Database not found');
	return { db: params.db };
};
