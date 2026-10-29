import { error } from '@sveltejs/kit';
import { getColumnEditorContext } from '#lib/server/database/create-table.ts';
import { listBaseTables, loadTableInfo } from '#lib/server/table/normalization.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, parent }) => {
	const { tableType } = await parent();
	if (tableType === 'view') error(400, 'A view cannot be normalized.');
	const dbi = await locals.dbi;
	const info = await loadTableInfo(dbi, params.db, params.table);
	if (!info) error(404, 'Table not found');
	return {
		db: params.db,
		table: params.table,
		info,
		tables: await listBaseTables(dbi, params.db),
		...(await getColumnEditorContext(dbi))
	};
};
