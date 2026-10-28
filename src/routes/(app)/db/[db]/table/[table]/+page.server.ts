import { redirect } from '@sveltejs/kit';
import { tabHref } from '#lib/nav/tabs.ts';
import { toNavConfig } from '#lib/server/navigation/config.ts';
import type { PageServerLoad } from './$types';

/** `/db/[db]/table/[table]` -> `DefaultTabTable` (browse unless configured). */
export const load: PageServerLoad = ({ params, locals }) => {
	const tab = toNavConfig(locals.config).defaultTabTable;
	redirect(307, tabHref('table', { db: params.db, table: params.table }, tab));
};
