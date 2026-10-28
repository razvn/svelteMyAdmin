import { loadSqlPage, runSqlAction } from '#lib/server/sql/page.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => loadSqlPage(event, { level: 'server' });

export const actions: Actions = {
	run: (event) => runSqlAction(event, { level: 'server' })
};
