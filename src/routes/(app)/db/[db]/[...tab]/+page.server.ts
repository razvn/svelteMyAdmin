import { error } from '@sveltejs/kit';
import { findPage, isValidTab } from '#lib/nav/tabs.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	if (!isValidTab('db', params.tab)) error(404, 'Page not found');
	const page = findPage('db', params.tab)!;
	return { tab: { path: page.path, label: page.label, phase: page.phase } };
};
