import { redirect } from '@sveltejs/kit';
import { serverHref } from '#lib/nav/config.ts';
import { toNavConfig } from '#lib/server/navigation/config.ts';
import type { PageServerLoad } from './$types';

/** `/server` -> the configured `DefaultTabServer`. */
export const load: PageServerLoad = ({ locals }) => {
	const target = serverHref(toNavConfig(locals.config));
	redirect(307, target === '/' ? '/server/databases' : target);
};
