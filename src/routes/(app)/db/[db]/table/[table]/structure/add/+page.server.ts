import { error } from '@sveltejs/kit';
import { getColumnEditorContext } from '#lib/server/database/create-table.ts';
import { alterAction } from '#lib/server/table/actions.ts';
import { addColumns, loadColumns, loadIndexes } from '#lib/server/table/structure.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url, parent }) => {
	const { tableType } = await parent();
	if (tableType === 'view') error(400, 'A view has no columns to add.');
	const dbi = await locals.dbi;
	const ctx = await getColumnEditorContext(dbi);
	const existing = (await loadColumns(dbi, params.db, params.table, ctx.caps)).map(
		(c) => c.def.name
	);
	const indexes = await loadIndexes(dbi, params.db, params.table);
	const whereRaw = url.searchParams.get('where');
	const after = url.searchParams.get('after') ?? '';
	const where =
		whereRaw === 'first'
			? 'first'
			: whereRaw === 'after' && existing.includes(after)
				? 'after'
				: 'end';
	return {
		...ctx,
		db: params.db,
		table: params.table,
		existing,
		hasPrimary: indexes.some((i) => i.kind === 'PRIMARY'),
		num: Math.min(Math.max(Number.parseInt(url.searchParams.get('num') ?? '', 10) || 1, 1), 64),
		where: where as 'end' | 'first' | 'after',
		after
	};
};

export const actions: Actions = {
	add: alterAction((ctx, p) => addColumns(ctx, p))
};
