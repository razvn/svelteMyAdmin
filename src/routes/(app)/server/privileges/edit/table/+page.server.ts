import { errorText } from '#lib/server/privileges/index.ts';
import { fail } from '@sveltejs/kit';
import {
	COLUMN_PRIVILEGES,
	currentFor,
	editContext,
	listColumnNames,
	listDatabaseNames,
	listTableNames,
	loadEditBase,
	parsePrivileges,
	revokeScoped,
	updateScopedPrivileges
} from '#lib/server/privileges/index.ts';
import { describeAccess, unescapeWildcards } from '#lib/sql/privileges/index.ts';
import type { Actions, PageServerLoad } from './$types';

const param = (url: URL, name: string) => (url.searchParams.get(name) ?? '').slice(0, 192);

export const load: PageServerLoad = async ({ locals, url }) => {
	const ctx = await editContext(locals, url);
	const base = await loadEditBase(ctx);
	const common = { account: ctx.account, server: ctx.server, isGrantUser: ctx.caps.isGrantUser };
	if (base.state !== 'ok') return { ...common, ...base };

	const { details } = base;
	const databases = await listDatabaseNames(ctx.dbi);
	// the db being worked in: explicit, else the first database the user has table grants on
	const dbname =
		param(url, 'dbname') ||
		(details.grants.tables[0] ? unescapeWildcards(details.grants.tables[0].db) : '');
	const inDb = details.grants.tables.filter((t) => unescapeWildcards(t.db) === dbname);
	const rows = inDb.map((t) => ({
		db: t.db,
		table: t.table,
		summary: describeAccess(
			{
				type: 'table-specific',
				db: t.db,
				privileges: [
					...t.privileges,
					...t.columns.map((c) => `${c.privilege} (${c.columns.join(', ')})`)
				],
				grantOption: t.grantOption
			},
			ctx.server
		),
		grantOption: t.grantOption
	}));
	const tablename = param(url, 'tablename');
	const tables = dbname && databases.includes(dbname) ? await listTableNames(ctx.dbi, dbname) : [];
	let editing: null | {
		columns: string[];
		initial: { privileges: string[]; grantOption: boolean };
		columnPrivileges: Record<string, string[]>;
	} = null;
	if (dbname && tablename) {
		const cur = currentFor(details, { scope: 'table', db: dbname, table: tablename });
		editing = {
			columns: await listColumnNames(ctx.dbi, dbname, tablename),
			initial: { privileges: cur.privileges, grantOption: cur.grantOption },
			columnPrivileges: Object.fromEntries(Object.entries(cur.columns).map(([k, v]) => [k, [...v]]))
		};
	}
	return {
		...common,
		state: 'ok' as const,
		databases,
		dbname,
		tablename,
		tables,
		rows,
		editing,
		columnPrivilegeNames: [...COLUMN_PRIVILEGES]
	};
};

export const actions: Actions = {
	save: async ({ request, locals, url }) => {
		const ctx = await editContext(locals, url);
		const fd = await request.formData();
		const db = String(fd.get('dbname') ?? '');
		const table = String(fd.get('tablename') ?? '');
		if (db === '' || table === '')
			return fail(400, { error: locals.i18n.t('No table selected.'), results: [] });
		const columns: Record<string, string[]> = {};
		for (const name of COLUMN_PRIVILEGES) {
			columns[name] = fd
				.getAll(`col_${name}`)
				.filter((v): v is string => typeof v === 'string' && v !== '');
		}
		const res = await updateScopedPrivileges(ctx.dbi, ctx.server, ctx.caps, [
			{
				account: ctx.account,
				target: { scope: 'table', db, table },
				privileges: parsePrivileges(fd),
				grantOption: fd.get('grant_option') !== null,
				columns
			}
		]);
		if (!res.ok) return fail(400, { error: errorText(res, locals.i18n), results: res.results });
		return {
			saved: locals.i18n.t("You have updated the privileges for '{user}'@'{host}' on {target}.", {
				user: ctx.account.user,
				host: ctx.account.host,
				target: `${db}.${table}`
			}),
			results: res.results
		};
	},

	revoke: async ({ request, locals, url }) => {
		const ctx = await editContext(locals, url);
		const fd = await request.formData();
		const db = String(fd.get('dbname') ?? '');
		const table = String(fd.get('tablename') ?? '');
		if (db === '' || table === '')
			return fail(400, { error: locals.i18n.t('No table selected.'), results: [] });
		const res = await revokeScoped(ctx.dbi, ctx.server, ctx.caps, ctx.account, {
			scope: 'table',
			db,
			table
		});
		if (!res.ok) return fail(400, { error: errorText(res, locals.i18n), results: res.results });
		return {
			saved: locals.i18n.t("You have revoked the privileges for '{user}' on {target}.", {
				user: ctx.account.user,
				target: `${db}.${table}`
			}),
			results: res.results
		};
	}
};
