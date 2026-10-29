import { fail } from '@sveltejs/kit';
import {
	editContext,
	listDatabaseNames,
	loadEditBase,
	parsePrivileges,
	revokeScoped,
	updateScopedPrivileges,
	currentFor
} from '#lib/server/privileges/index.ts';
import { describeAccess, escapeWildcards } from '#lib/sql/privileges/index.ts';
import type { Actions, PageServerLoad } from './$types';

const clean = (values: string[]) =>
	[...new Set(values.map((v) => v.trim()).filter((v) => v !== '' && v.length <= 192))];

/** Databases to edit: stored patterns (`dbname`), picked real names (escaped) and the wildcard text field. */
function selectedDatabases(params: URLSearchParams): string[] {
	return clean([
		...params.getAll('dbname'),
		...params.getAll('dbpick').map(escapeWildcards),
		params.get('dbwild') ?? ''
	]);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const ctx = await editContext(locals, url);
	const base = await loadEditBase(ctx);
	const common = { account: ctx.account, server: ctx.server, isGrantUser: ctx.caps.isGrantUser };
	if (base.state !== 'ok') return { ...common, ...base };

	const { details } = base;
	const rows = details.grants.databases.map((d) => ({
		db: d.db,
		summary: describeAccess(
			{ type: 'database-specific', db: d.db, privileges: d.privileges, grantOption: d.grantOption },
			ctx.server
		),
		grantOption: d.grantOption
	}));
	const editing = selectedDatabases(url.searchParams);
	const first = editing.length === 1 ? currentFor(details, { scope: 'database', db: editing[0] }) : null;
	return {
		...common,
		state: 'ok' as const,
		rows,
		databases: await listDatabaseNames(ctx.dbi),
		editing,
		initial: { privileges: first?.privileges ?? [], grantOption: first?.grantOption ?? false }
	};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const ctx = await editContext(locals, url);
		const fd = await request.formData();
		const dbs = clean(fd.getAll('dbname').filter((v): v is string => typeof v === 'string'));
		if (dbs.length === 0) return fail(400, { error: 'No database selected.', results: [] });
		const privileges = parsePrivileges(fd);
		const grantOption = fd.get('grant_option') !== null;
		const res = await updateScopedPrivileges(
			ctx.dbi,
			ctx.server,
			ctx.caps,
			dbs.map((db) => ({
				account: ctx.account,
				target: { scope: 'database' as const, db },
				privileges,
				grantOption
			}))
		);
		if (!res.ok) return fail(400, { error: res.error ?? null, results: res.results });
		return {
			saved: `You have updated the privileges for '${ctx.account.user}'@'${ctx.account.host}' on ${dbs.join(', ')}.`,
			results: res.results
		};
	},

	revoke: async ({ request, locals, url }) => {
		const ctx = await editContext(locals, url);
		const db = String((await request.formData()).get('dbname') ?? '');
		if (db === '') return fail(400, { error: 'No database selected.', results: [] });
		const res = await revokeScoped(ctx.dbi, ctx.server, ctx.caps, ctx.account, {
			scope: 'database',
			db
		});
		if (!res.ok) return fail(400, { error: res.error ?? null, results: res.results });
		return { saved: `You have revoked the privileges for '${ctx.account.user}' on ${db}.`, results: res.results };
	}
};
