import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Column privileges are a section of the table editor (as in phpMyAdmin). */
export const load: PageServerLoad = ({ url }) => {
	redirect(303, `/server/privileges/edit/table${url.search}#column-privileges`);
};
