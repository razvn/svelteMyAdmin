import { errorText } from '#lib/server/privileges/index.ts';
import { fail } from '@sveltejs/kit';
import {
	currentFor,
	editContext,
	listDatabaseNames,
	listRoutineNames,
	loadEditBase,
	parsePrivileges,
	revokeScoped,
	updateScopedPrivileges
} from '#lib/server/privileges/index.ts';
import { describeAccess, unescapeWildcards, type RoutineType } from '#lib/sql/privileges/index.ts';
import type { Actions, PageServerLoad } from './$types';

/** `PROCEDURE|name` (the value of the routine pickers). */
function parseRoutine(value: string): { type: RoutineType; name: string } | null {
	const i = value.indexOf('|');
	const type = value.slice(0, i);
	const name = value.slice(i + 1);
	if ((type !== 'PROCEDURE' && type !== 'FUNCTION') || name === '') return null;
	return { type, name };
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const ctx = await editContext(locals, url);
	const base = await loadEditBase(ctx);
	const common = { account: ctx.account, server: ctx.server, isGrantUser: ctx.caps.isGrantUser };
	if (base.state !== 'ok') return { ...common, ...base };

	const { details } = base;
	const databases = await listDatabaseNames(ctx.dbi);
	const dbname =
		(url.searchParams.get('dbname') ?? '').slice(0, 192) ||
		(details.grants.routines[0] ? unescapeWildcards(details.grants.routines[0].db) : '');
	const rows = details.grants.routines
		.filter((r) => unescapeWildcards(r.db) === dbname)
		.map((r) => ({
			routine: r.routine,
			type: r.type,
			summary: describeAccess(
				{ type: 'routine', db: r.db, privileges: r.privileges, grantOption: r.grantOption },
				ctx.server
			),
			grantOption: r.grantOption
		}));
	const routines =
		dbname && databases.includes(dbname) ? await listRoutineNames(ctx.dbi, dbname) : [];
	const picked = parseRoutine(url.searchParams.get('routine') ?? '');
	let initial = null;
	if (picked && dbname) {
		const cur = currentFor(details, {
			scope: 'routine',
			db: dbname,
			routine: picked.name,
			type: picked.type
		});
		initial = { privileges: cur.privileges, grantOption: cur.grantOption };
	}
	return { ...common, state: 'ok' as const, databases, dbname, rows, routines, picked, initial };
};

export const actions: Actions = {
	save: async ({ request, locals, url }) => {
		const ctx = await editContext(locals, url);
		const fd = await request.formData();
		const db = String(fd.get('dbname') ?? '');
		const r = parseRoutine(String(fd.get('routine') ?? ''));
		if (db === '' || !r)
			return fail(400, { error: locals.i18n.t('No routine selected.'), results: [] });
		const res = await updateScopedPrivileges(ctx.dbi, ctx.server, ctx.caps, [
			{
				account: ctx.account,
				target: { scope: 'routine', db, routine: r.name, type: r.type },
				privileges: parsePrivileges(fd),
				grantOption: fd.get('grant_option') !== null
			}
		]);
		if (!res.ok) return fail(400, { error: errorText(res, locals.i18n), results: res.results });
		return {
			saved: locals.i18n.t("You have updated the privileges for '{user}'@'{host}' on {target}.", {
				user: ctx.account.user,
				host: ctx.account.host,
				target: `${r.type} ${db}.${r.name}`
			}),
			results: res.results
		};
	},

	revoke: async ({ request, locals, url }) => {
		const ctx = await editContext(locals, url);
		const fd = await request.formData();
		const db = String(fd.get('dbname') ?? '');
		const r = parseRoutine(String(fd.get('routine') ?? ''));
		if (db === '' || !r)
			return fail(400, { error: locals.i18n.t('No routine selected.'), results: [] });
		const res = await revokeScoped(ctx.dbi, ctx.server, ctx.caps, ctx.account, {
			scope: 'routine',
			db,
			routine: r.name,
			type: r.type
		});
		if (!res.ok) return fail(400, { error: errorText(res, locals.i18n), results: res.results });
		return {
			saved: locals.i18n.t("You have revoked the privileges for '{user}' on {target}.", {
				user: ctx.account.user,
				target: `${db}.${r.name}`
			}),
			results: res.results
		};
	}
};
