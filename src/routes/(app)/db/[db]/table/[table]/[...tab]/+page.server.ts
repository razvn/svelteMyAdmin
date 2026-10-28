import { error } from '@sveltejs/kit';
import { findPage, isValidTab } from '#lib/nav/tabs.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { tableType } = await parent();
	if (!isValidTab('table', params.tab, { isView: tableType === 'view' })) {
		error(404, 'Page not found');
	}
	const page = findPage('table', params.tab)!;
	return { tab: { path: page.path, label: page.label, phase: page.phase } };
};
