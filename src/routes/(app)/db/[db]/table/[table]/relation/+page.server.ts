import { alterAction } from '#lib/server/table/actions.ts';
import {
	detectStorage,
	dropForeignKey,
	getEngine,
	loadDisplayField,
	loadForeignKeys,
	loadInternalRelations,
	saveDisplayField,
	saveForeignKey,
	saveInternalRelation,
	type RelationServer
} from '#lib/server/table/relation.ts';
import { getCaps, loadColumns } from '#lib/server/table/structure.ts';
import { supportsForeignKeys } from '#lib/sql/foreign-key.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, parent }) => {
	const { tableType } = await parent();
	const dbi = await locals.dbi;
	const { db, table } = params;
	const server = locals.server as RelationServer;
	const isView = tableType === 'view';
	const caps = await getCaps(dbi);
	const [columns, engine, foreignKeys, databases, storage] = await Promise.all([
		loadColumns(dbi, db, table, caps),
		getEngine(dbi, db, table),
		isView ? [] : loadForeignKeys(dbi, db, table),
		dbi.listDatabases(),
		detectStorage(dbi, server)
	]);
	const [internal, displayField] = await Promise.all([
		storage.relation ? loadInternalRelations(dbi, server, db, table) : [],
		storage.tableInfo ? loadDisplayField(dbi, server, db, table) : ''
	]);
	return {
		db,
		table,
		isView,
		engine,
		fkSupported: supportsForeignKeys(engine),
		columns: columns.map((c) => c.def.name),
		foreignKeys,
		databases,
		storage,
		internal,
		displayField
	};
};

export const actions: Actions = {
	saveFk: alterAction((ctx, p) => saveForeignKey(ctx, p)),
	dropFk: alterAction((ctx, p) => dropForeignKey(ctx, p)),
	saveInternal: alterAction((ctx, p, event) =>
		saveInternalRelation(ctx, event.locals.server as RelationServer, p)
	),
	saveDisplay: alterAction((ctx, p, event) =>
		saveDisplayField(ctx, event.locals.server as RelationServer, p)
	)
};
