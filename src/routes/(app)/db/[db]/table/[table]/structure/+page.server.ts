import { isSystemSchema } from '#lib/server/admin/databases.ts';
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
	renameIndex: alterAction((ctx, p) => renameIndex(ctx, p))
};
