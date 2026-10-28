import { error } from '@sveltejs/kit';
import { loadImportPage } from '#lib/server/import/page.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { tableType } = await event.parent();
	if (tableType === 'view') error(404, 'Page not found');
	return loadImportPage(event, { level: 'table', db: event.params.db, table: event.params.table });
};
