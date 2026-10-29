import { error } from '@sveltejs/kit';
import { getColumnEditorContext } from '#lib/server/database/create-table.ts';
import { alterAction } from '#lib/server/table/actions.ts';
import { saveStructureTransforms, transformUi } from '#lib/server/transformations/structure.ts';
import { changeColumns, loadColumns } from '#lib/server/table/structure.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url, parent }) => {
	const { tableType } = await parent();
	if (tableType === 'view')
		error(400, locals.i18n.t('The columns of a view cannot be changed here.'));
	const dbi = await locals.dbi;
	const ctx = await getColumnEditorContext(dbi);
	const all = await loadColumns(dbi, params.db, params.table, ctx.caps);
	const wanted = url.searchParams.getAll('field');
	const picked = all.filter((c) => wanted.includes(c.def.name));
	if (wanted.length === 0 || picked.length !== new Set(wanted).size) {
		error(404, locals.i18n.t('Column not found'));
	}
	return {
		...ctx,
		db: params.db,
		table: params.table,
		columns: picked.map((c) => c.def),
		transformUi: await transformUi(
			locals,
			params.db,
			params.table,
			picked.map((c) => ({ id: c.def.id, name: c.def.name }))
		)
	};
};

export const actions: Actions = {
	change: alterAction(async (ctx, p, event) => {
		const res = await changeColumns(ctx, p);
		if (res.ok) await saveStructureTransforms(event.locals, ctx.dbi, ctx.db, ctx.table, p);
		return res;
	})
};
