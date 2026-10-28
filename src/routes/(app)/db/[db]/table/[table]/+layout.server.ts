import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	const dbi = await locals.dbi;
	const type = await dbi.getTableType(params.db, params.table);
	if (type === null) error(404, 'Table not found');
	const isView = type === 'VIEW' || type === 'SYSTEM VIEW';
	return { table: params.table, tableType: isView ? ('view' as const) : ('table' as const) };
};
