import { redirect } from '@sveltejs/kit';
import { tabHref } from '#lib/nav/tabs.ts';
import { toNavConfig } from '#lib/server/navigation/config.ts';
import type { PageServerLoad } from './$types';

/** `/db/[db]` -> `DefaultTabDatabase` (structure unless configured). */
export const load: PageServerLoad = ({ params, locals }) => {
	redirect(307, tabHref('db', { db: params.db }, toNavConfig(locals.config).defaultTabDatabase));
};
