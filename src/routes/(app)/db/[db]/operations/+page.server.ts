import { fail } from '@sveltejs/kit';
import { dropDatabases, getServerPrivileges, isSystemSchema } from '#lib/server/admin/databases.ts';
import {
	canAdjustPrivileges,
	changeCollation,
	collationSchema,
	copyDatabase,
	copySchema,
	formToObject,
	getDatabaseCollation,
	getDbComment,
	hasColumnInfo,
	renameDatabase,
	renameSchema,
	setDbComment,
	transferColumnInfo
} from '#lib/server/database/operations.ts';
import { escapeId } from '#lib/server/db/escape.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const dbi = await locals.dbi;
	const { server, config } = locals;
	const systemSchema = isSystemSchema(params.db);
	const hasComment = !systemSchema && (await hasColumnInfo(dbi, server));
	const priv = await getServerPrivileges(dbi);
	const collations = systemSchema ? [] : await dbi.listCollations();
	return {
		isSystemSchema: systemSchema,
		hasComment,
		comment: hasComment ? await getDbComment(dbi, server, params.db).catch(() => '') : '',
		collation: await getDatabaseCollation(dbi, params.db),
		collations: collations.map((c) => ({ name: c.name, charset: c.charset })),
		canAdjustPrivileges: systemSchema ? false : await canAdjustPrivileges(dbi),
		dropAllowed:
			!systemSchema && (priv.isSuperUser || config.AllowUserDropDatabase) && params.db !== 'mysql'
	};
};

const failure = (action: string, message: string, sql: string[] = []) =>
	fail(400, { action, ok: false, message, sql });

export const actions: Actions = {
	comment: async ({ request, locals, params }) => {
		const dbi = await locals.dbi;
		if (!(await hasColumnInfo(dbi, locals.server))) {
			return failure('comment', locals.i18n.t('Configuration storage unavailable.'));
		}
		const comment = String((await request.formData()).get('comment') ?? '').slice(0, 255);
		const res = await setDbComment(dbi, locals.server, params.db, comment);
		if (res.error) return failure('comment', res.error, res.sql);
		return {
			action: 'comment',
			ok: true,
			message: locals.i18n.t('The database comment has been saved.'),
			sql: res.sql
		};
	},
	rename: async ({ request, locals, params }) => {
		const dbi = await locals.dbi;
		if (isSystemSchema(params.db)) return failure('rename', locals.i18n.t('System databases cannot be renamed.'));
		const parsed = renameSchema.safeParse(formToObject(await request.formData()));
		if (!parsed.success) return failure('rename', locals.i18n.t('Invalid input.'));
		const res = await renameDatabase(
			dbi,
			params.db,
			{ newName: parsed.data.newname, adjustPrivileges: parsed.data.adjust_privileges },
			{ afterCopy: (a, b, move) => transferColumnInfo(dbi, locals.server, a, b, move) },
			locals.i18n
		);
		const body = { action: 'rename', ...res };
		return res.ok ? body : fail(400, body);
	},
	copy: async ({ request, locals, params }) => {
		const dbi = await locals.dbi;
		const parsed = copySchema.safeParse(formToObject(await request.formData()));
		if (!parsed.success) return failure('copy', locals.i18n.t('Invalid input.'));
		const p = parsed.data;
		const res = await copyDatabase(
			dbi,
			params.db,
			{
				newName: p.newname,
				what: p.what,
				createDatabase: p.create_database_before_copying,
				dropTable: p.drop_if_exists,
				autoIncrement: p.sql_auto_increment,
				constraints: p.add_constraints,
				adjustPrivileges: p.adjust_privileges,
				switchToNew: p.switch_to_new
			},
			{ afterCopy: (a, b, move) => transferColumnInfo(dbi, locals.server, a, b, move) },
			locals.i18n
		);
		const body = { action: 'copy', ...res };
		return res.ok ? body : fail(400, body);
	},
	collation: async ({ request, locals, params }) => {
		const dbi = await locals.dbi;
		const parsed = collationSchema.safeParse(formToObject(await request.formData()));
		if (!parsed.success) return failure('collation', locals.i18n.t('No collation provided.'));
		const res = await changeCollation(dbi, params.db, {
			collation: parsed.data.db_collation,
			changeTables: parsed.data.change_all_tables_collations,
			changeColumns: parsed.data.change_all_tables_columns_collations
		}, locals.i18n);
		const body = { action: 'collation', ...res };
		return res.ok ? body : fail(400, body);
	},
	drop: async ({ locals, params }) => {
		const dbi = await locals.dbi;
		const priv = await getServerPrivileges(dbi);
		if (
			isSystemSchema(params.db) ||
			params.db === 'mysql' ||
			(!priv.isSuperUser && !locals.config.AllowUserDropDatabase)
		) {
			return fail(403, {
				action: 'drop',
				ok: false,
				message: locals.i18n.t('No privileges to drop this database.'),
				sql: []
			});
		}
		const sql = [`DROP DATABASE ${escapeId(params.db)}`];
		const res = await dropDatabases(dbi, [params.db], { pmadb: locals.server.pmadb });
		if (!res.ok) return failure('drop', res.error, sql);
		return {
			action: 'drop',
			ok: true,
			message: locals.i18n.t('Database {db} has been dropped.', { db: params.db }),
			sql,
			goto: '/server/databases'
		};
	}
};
