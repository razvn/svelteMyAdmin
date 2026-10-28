import { loadSqlPage, runSqlAction } from '#lib/server/sql/page.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) =>
	loadSqlPage(event, { level: 'table', db: event.params.db, table: event.params.table });

export const actions: Actions = {
	run: (event) =>
		runSqlAction(event, { level: 'table', db: event.params.db, table: event.params.table })
};
