import { errorText } from '#lib/server/privileges/index.ts';
import { error, fail } from '@sveltejs/kit';
import {
	editContext,
	grantRoleTo,
	listGrantedRoles,
	listRoles,
	loadEditBase,
	revokeRoleFrom,
	setDefaultRoles
} from '#lib/server/privileges/index.ts';
import { supportsRoles } from '#lib/sql/privileges/index.ts';
import type { Actions, PageServerLoad } from './$types';

/** `name|host` (host empty on MariaDB). */
function parseRoleValue(
	value: FormDataEntryValue | null
): { role: string; host: string | null } | null {
	if (typeof value !== 'string') return null;
	const i = value.lastIndexOf('|');
	if (i <= 0) return null;
	const host = value.slice(i + 1);
	return { role: value.slice(0, i), host: host === '' ? null : host };
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const ctx = await editContext(locals, url);
	if (!supportsRoles(ctx.server))
		error(404, locals.i18n.t('Roles are not supported by this server.'));
	const base = await loadEditBase(ctx);
	const common = { account: ctx.account, server: ctx.server, isGrantUser: ctx.caps.isGrantUser };
	if (base.state !== 'ok') return { ...common, ...base };
	const granted = await listGrantedRoles(ctx.dbi, ctx.server, ctx.account);
	const all = await listRoles(ctx.dbi, ctx.server);
	const self = (r: { name: string; host: string }) =>
		r.name === ctx.account.user && r.host === ctx.account.host;
	return {
		...common,
		state: 'ok' as const,
		granted,
		available: all
			.filter((r) => !self(r) && !granted.some((g) => g.role === r.name))
			.map((r) => ({ name: r.name, host: r.host }))
	};
};

export const actions: Actions = {
	grant: async ({ request, locals, url }) => {
		const ctx = await editContext(locals, url);
		const fd = await request.formData();
		const role = parseRoleValue(fd.get('role'));
		if (!role) return fail(400, { error: locals.i18n.t('No role selected.'), results: [] });
		const res = await grantRoleTo(ctx.dbi, ctx.server, ctx.caps, {
			role: role.role,
			roleHost: role.host ?? undefined,
			to: ctx.account,
			adminOption: fd.get('admin_option') !== null
		});
		if (!res.ok) return fail(400, { error: errorText(res, locals.i18n), results: res.results });
		return {
			saved: locals.i18n.t('The role {name} was granted.', { name: role.role }),
			results: res.results
		};
	},

	revoke: async ({ request, locals, url }) => {
		const ctx = await editContext(locals, url);
		const role = parseRoleValue((await request.formData()).get('role'));
		if (!role) return fail(400, { error: locals.i18n.t('No role selected.'), results: [] });
		const res = await revokeRoleFrom(ctx.dbi, ctx.server, ctx.caps, {
			role: role.role,
			roleHost: role.host ?? undefined,
			from: ctx.account
		});
		if (!res.ok) return fail(400, { error: errorText(res, locals.i18n), results: res.results });
		return {
			saved: locals.i18n.t('The role {name} was revoked.', { name: role.role }),
			results: res.results
		};
	},

	defaults: async ({ request, locals, url }) => {
		const ctx = await editContext(locals, url);
		const fd = await request.formData();
		const roles = fd
			.getAll('default')
			.map(parseRoleValue)
			.filter((r): r is NonNullable<typeof r> => r !== null);
		const res = await setDefaultRoles(ctx.dbi, ctx.server, ctx.caps, {
			account: ctx.account,
			roles
		});
		if (!res.ok) return fail(400, { error: errorText(res, locals.i18n), results: res.results });
		return { saved: locals.i18n.t('The default roles were updated.'), results: res.results };
	}
};
