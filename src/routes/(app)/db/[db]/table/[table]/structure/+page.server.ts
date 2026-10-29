import { isSystemSchema } from '#lib/server/admin/databases.ts';
import { fail } from '@sveltejs/kit';
import { storageTable, withStorageTable } from '#lib/server/pmadb/index.ts';
import { addTableColumns, deleteCentral } from '#lib/server/pmadb/central-columns.ts';
import { alterAction } from '#lib/server/table/actions.ts';
import {
	addKey,
	dropColumns,
	dropIndex,
	getCaps,
	loadColumns,
	loadIndexes,
	loadPartitions,
	loadStats,
	moveColumns,
	renameIndex,
	saveIndex
} from '#lib/server/table/structure.ts';
import { supportsInvisibleIndex, supportsRenameIndex } from '#lib/sql/index-definition.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, parent }) => {
	const { tableType } = await parent();
	const dbi = await locals.dbi;
	const { db, table } = params;
	const caps = await getCaps(dbi);
	const isView = tableType === 'view';
	const [columns, indexes, stats, partitions] = await Promise.all([
		loadColumns(dbi, db, table, caps),
		isView ? [] : loadIndexes(dbi, db, table),
		isView ? null : loadStats(dbi, db, table),
		isView ? null : loadPartitions(dbi, db, table)
	]);
	return {
		db,
		table,
		isView,
		isSystem: isSystemSchema(db),
		caps,
		columns,
		indexes,
		stats,
		partitions,
		centralAvailable: storageTable(locals.server, 'central_columns') !== null,
		canRenameIndex: supportsRenameIndex(caps),
		canInvisible: supportsInvisibleIndex(caps),
		invisibleLabel:
			caps.serverType === 'MariaDB' ? locals.i18n.t('Ignored') : locals.i18n.t('Invisible')
	};
};

export const actions: Actions = {
	drop: alterAction((ctx, p) => dropColumns(ctx, p)),
	key: alterAction((ctx, p) => addKey(ctx, p)),
	move: alterAction((ctx, p) => moveColumns(ctx, p)),
	saveIndex: alterAction((ctx, p) => saveIndex(ctx, p)),
	dropIndex: alterAction((ctx, p) => dropIndex(ctx, p)),
	renameIndex: alterAction((ctx, p) => renameIndex(ctx, p)),
	centralAdd: async ({ request, locals, params }) => {
		const columns = (await request.formData()).getAll('column').map(String);
		const dbi = await locals.dbi;
		const res = await withStorageTable(locals, 'central_columns', (conn, q) =>
			addTableColumns(conn, q, dbi, params.db, params.table, columns)
		);
		if (!res)
			return fail(400, { error: locals.i18n.t('The central list of columns is not available.') });
		return {
			message:
				locals.i18n.t('{n} column(s) added to the central list.', { n: res.added.length }) +
				(res.existing.length
					? ' ' +
						locals.i18n.t('Already in the list: {columns}.', { columns: res.existing.join(', ') })
					: '')
		};
	},
	centralRemove: async ({ request, locals, params }) => {
		const columns = (await request.formData()).getAll('column').map(String);
		const missing = await withStorageTable(locals, 'central_columns', (conn, q) =>
			deleteCentral(conn, q, params.db, columns)
		);
		if (!missing)
			return fail(400, { error: locals.i18n.t('The central list of columns is not available.') });
		return {
			message:
				locals.i18n.t('{n} column(s) removed from the central list.', {
					n: columns.length - missing.length
				}) +
				(missing.length
					? ' ' + locals.i18n.t('Not in the list: {columns}.', { columns: missing.join(', ') })
					: '')
		};
	}
};
