import { error, fail } from '@sveltejs/kit';
import { isSystemSchema } from '#lib/server/admin/databases.ts';
import { canAdjustPrivileges, formToObject } from '#lib/server/database/operations.ts';
import {
	applyOptions,
	copySchema,
	copyTable,
	dangerSchema,
	dropTable,
	emptyTable,
	getPartitions,
	getTableStatus,
	hasClusteredKey,
	hasForeignKeys,
	listUsableEngines,
	maintainPartitions,
	maintainTable,
	maintenanceSchema,
	moveSchema,
	moveTable,
	optionsSchema,
	partitionSchema,
	reorderSchema,
	reorderTable,
	type TableOutcome
} from '#lib/server/table/operations.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const dbi = await locals.dbi;
	const status = await getTableStatus(dbi, params.db, params.table);
	if (!status) error(404, 'Table not found');
	const systemSchema = isSystemSchema(params.db);
	const [engines, collations, databases, columns, partitions] = await Promise.all([
		status.isView ? [] : listUsableEngines(dbi),
		status.isView ? [] : dbi.listCollations(),
		dbi.listDatabases(),
		status.isView ? [] : dbi.getColumns(params.db, params.table),
		status.isView ? null : getPartitions(dbi, params.db, params.table)
	]);
	const innodb = status.options.engine.toUpperCase() === 'INNODB';
	return {
		isView: status.isView,
		isSystemSchema: systemSchema,
		options: status.options,
		numRows: status.numRows,
		engines,
		collations: collations.map((c) => ({ name: c.name, charset: c.charset })),
		databases: databases.filter((d) => !isSystemSchema(d)),
		columns: columns.map((c) => c.field),
		innodbClustered:
			innodb && !status.isView ? await hasClusteredKey(dbi, params.db, params.table) : false,
		partitions,
		canAdjustPrivileges: systemSchema ? false : await canAdjustPrivileges(dbi),
		hasForeignKeys: status.isView ? false : await hasForeignKeys(dbi, params.db, params.table)
	};
};

const reply = (action: string, res: TableOutcome) => {
	const body = { action, ...res };
	return res.ok ? body : fail(400, body);
};
const invalid = (action: string) =>
	fail(400, { action, ok: false, message: 'Invalid input.', sql: [] as string[] });

export const actions: Actions = {
	reorder: async ({ request, locals, params }) => {
		const p = reorderSchema.safeParse(formToObject(await request.formData()));
		if (!p.success) return invalid('reorder');
		const dbi = await locals.dbi;
		return reply(
			'reorder',
			await reorderTable(dbi, params.db, params.table, p.data.order_field, p.data.order_order)
		);
	},
	move: async ({ request, locals, params }) => {
		const p = moveSchema.safeParse(formToObject(await request.formData()));
		if (!p.success) return invalid('move');
		const dbi = await locals.dbi;
		return reply(
			'move',
			await moveTable(
				dbi,
				params.db,
				params.table,
				{
					targetDb: p.data.target_db,
					newName: p.data.new_name,
					adjustPrivileges: p.data.adjust_privileges
				},
				locals.server
			)
		);
	},
	options: async ({ request, locals, params }) => {
		const p = optionsSchema.safeParse(formToObject(await request.formData()));
		if (!p.success) return invalid('options');
		const d = p.data;
		const dbi = await locals.dbi;
		const collation = d.tbl_collation
			? (await dbi.listCollations()).find((c) => c.name === d.tbl_collation)
			: undefined;
		if (d.tbl_collation && !collation) {
			return fail(400, { action: 'options', ok: false, message: 'Unknown collation.', sql: [] });
		}
		return reply(
			'options',
			await applyOptions(
				dbi,
				params.db,
				params.table,
				{
					newName: d.new_name ?? '',
					adjustPrivileges: d.adjust_privileges,
					changeAllCollations: d.change_all_collations,
					comment: d.comment,
					engine: d.new_tbl_storage_engine,
					collation: collation?.name,
					charset: collation?.charset,
					packKeys: d.new_pack_keys,
					checksum: d.has_checksum_group ? d.new_checksum : undefined,
					delayKeyWrite: d.has_checksum_group ? d.new_delay_key_write : undefined,
					transactional: d.has_aria_group ? d.new_transactional : undefined,
					pageChecksum: d.has_aria_group ? d.new_page_checksum : undefined,
					autoIncrement: d.new_auto_increment,
					rowFormat: d.new_row_format
				},
				locals.server
			)
		);
	},
	copy: async ({ request, locals, params }) => {
		const p = copySchema.safeParse(formToObject(await request.formData()));
		if (!p.success) return invalid('copy');
		const d = p.data;
		const dbi = await locals.dbi;
		return reply(
			'copy',
			await copyTable(
				dbi,
				params.db,
				params.table,
				{
					targetDb: d.target_db,
					newName: d.new_name,
					what: d.what,
					dropTable: d.drop_if_exists,
					autoIncrement: d.sql_auto_increment,
					constraints: d.add_constraints,
					adjustPrivileges: d.adjust_privileges,
					switchToNew: d.switch_to_new
				},
				locals.server
			)
		);
	},
	maintenance: async ({ request, locals, params }) => {
		const p = maintenanceSchema.safeParse(formToObject(await request.formData()));
		if (!p.success) return invalid('maintenance');
		const dbi = await locals.dbi;
		const status = await getTableStatus(dbi, params.db, params.table);
		if (!status) error(404, 'Table not found');
		return reply(
			'maintenance',
			await maintainTable(dbi, params.db, params.table, p.data.action, status.isView)
		);
	},
	empty: async ({ request, locals, params }) => {
		const p = dangerSchema.safeParse(formToObject(await request.formData()));
		if (!p.success) return invalid('empty');
		const dbi = await locals.dbi;
		return reply('empty', await emptyTable(dbi, params.db, params.table, p.data.fk_checks));
	},
	drop: async ({ request, locals, params }) => {
		const p = dangerSchema.safeParse(formToObject(await request.formData()));
		if (!p.success) return invalid('drop');
		const dbi = await locals.dbi;
		const status = await getTableStatus(dbi, params.db, params.table);
		if (!status) error(404, 'Table not found');
		return reply(
			'drop',
			await dropTable(dbi, params.db, params.table, status.isView, p.data.fk_checks)
		);
	},
	partition: async ({ request, locals, params }) => {
		const data = await request.formData();
		const p = partitionSchema.safeParse({
			operation: data.get('operation'),
			partitions: data.getAll('partitions').map(String)
		});
		if (!p.success) return invalid('partition');
		const dbi = await locals.dbi;
		return reply(
			'partition',
			await maintainPartitions(dbi, params.db, params.table, p.data.operation, p.data.partitions)
		);
	},
	unpartition: async ({ locals, params }) => {
		const dbi = await locals.dbi;
		return reply('unpartition', await maintainPartitions(dbi, params.db, params.table, null, []));
	}
};
