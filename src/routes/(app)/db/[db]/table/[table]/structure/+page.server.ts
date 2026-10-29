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
		invisibleLabel: caps.serverType === 'MariaDB' ? 'Ignored' : 'Invisible'
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
		if (!res) return fail(400, { error: 'The central list of columns is not available.' });
		return {
			message:
				`${res.added.length} column(s) added to the central list.` +
				(res.existing.length ? ` Already in the list: ${res.existing.join(', ')}.` : '')
		};
	},
	centralRemove: async ({ request, locals, params }) => {
		const columns = (await request.formData()).getAll('column').map(String);
		const missing = await withStorageTable(locals, 'central_columns', (conn, q) =>
			deleteCentral(conn, q, params.db, columns)
		);
		if (!missing) return fail(400, { error: 'The central list of columns is not available.' });
		return {
			message:
				`${columns.length - missing.length} column(s) removed from the central list.` +
				(missing.length ? ` Not in the list: ${missing.join(', ')}.` : '')
		};
	}
};
