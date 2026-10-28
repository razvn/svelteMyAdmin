import { error } from '@sveltejs/kit';
import { getColumnEditorContext } from '#lib/server/database/create-table.ts';
import { alterAction } from '#lib/server/table/actions.ts';
import { changeColumns, loadColumns } from '#lib/server/table/structure.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url, parent }) => {
	const { tableType } = await parent();
	if (tableType === 'view') error(400, 'The columns of a view cannot be changed here.');
	const dbi = await locals.dbi;
	const ctx = await getColumnEditorContext(dbi);
	const all = await loadColumns(dbi, params.db, params.table, ctx.caps);
	const wanted = url.searchParams.getAll('field');
	const picked = all.filter((c) => wanted.includes(c.def.name));
	if (wanted.length === 0 || picked.length !== new Set(wanted).size) {
		error(404, 'Column not found');
	}
	return {
		...ctx,
		db: params.db,
		table: params.table,
		columns: picked.map((c) => c.def)
	};
};

export const actions: Actions = {
	change: alterAction((ctx, p) => changeColumns(ctx, p))
};
