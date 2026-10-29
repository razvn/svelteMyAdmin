import { error } from '@sveltejs/kit';
import { recordRecent } from '#lib/server/pmadb/recent-favorite.ts';
import { guardTab } from '#lib/server/pmadb/user-groups.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals, url }) => {
	const ctx = { db: params.db, table: params.table };
	const deniedTabs = await guardTab(locals, 'table', ctx, url.pathname);
	const dbi = await locals.dbi;
	const type = await dbi.getTableType(params.db, params.table);
	if (type === null) error(404, 'Table not found');
	await recordRecent(locals, ctx);
	const isView = type === 'VIEW' || type === 'SYSTEM VIEW';
	return {
		table: params.table,
		deniedTabs,
		tableType: isView ? ('view' as const) : ('table' as const)
	};
};
