import { fail } from '@sveltejs/kit';
import {
	createDatabase,
	dropDatabases,
	getServerCollation,
	getServerPrivileges,
	listDatabasesFull,
	paginate,
	parseQuery,
	sumStats
} from '#lib/server/admin/databases.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const dbi = await locals.dbi;
	const { config, server } = locals;
	const q = parseQuery(url.searchParams);
	const priv = await getServerPrivileges(dbi);
	const all = await listDatabasesFull(dbi, {
		statistics: q.statistics,
		sortBy: q.sort_by,
		sortOrder: q.sort_order,
		pmadb: server.pmadb
	});
	const page = paginate(all, q.pos, config.MaxDbList);
	const showCreate = config.ShowCreateDb;
	const collations = showCreate && priv.canCreateDb ? await dbi.listCollations() : [];
	return {
		databases: page,
		total: all.length,
		totals: q.statistics ? sumStats(page) : null,
		statistics: q.statistics,
		pos: q.pos,
		sortBy: q.sort_by,
		sortOrder: q.sort_order,
		maxDbList: config.MaxDbList,
		showCreate,
		canCreate: priv.canCreateDb,
		dropAllowed: priv.isSuperUser || config.AllowUserDropDatabase,
		defaultCollation: showCreate ? await getServerCollation(dbi) : '',
		collations: collations.map((c) => ({ name: c.name, charset: c.charset }))
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const dbi = await locals.dbi;
		const priv = await getServerPrivileges(dbi);
		if (!locals.config.ShowCreateDb || !priv.canCreateDb) {
			return fail(403, { createError: locals.i18n.t('No privileges to create databases') });
		}
		const res = await createDatabase(dbi, {
			new_db: String(form.get('new_db') ?? ''),
			db_collation: String(form.get('db_collation') ?? '')
		}, locals.i18n);
		if (!res.ok) return fail(400, { createError: res.error });
		return { created: res.name };
	},
	drop: async ({ request, locals }) => {
		const form = await request.formData();
		const dbi = await locals.dbi;
		const priv = await getServerPrivileges(dbi);
		if (!priv.isSuperUser && !locals.config.AllowUserDropDatabase) {
			return fail(403, { dropError: locals.i18n.t('No privileges to drop databases') });
		}
		const names = form.getAll('selected_dbs').map(String);
		const res = await dropDatabases(dbi, names, { pmadb: locals.server.pmadb }, locals.i18n);
		if (!res.ok) return fail(400, { dropError: res.error });
		return { dropped: res.dropped, skipped: res.skipped };
	}
};
