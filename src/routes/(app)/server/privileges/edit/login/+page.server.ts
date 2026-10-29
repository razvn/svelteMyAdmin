import { fail } from '@sveltejs/kit';
import {
	changeLogin,
	changePassword,
	editContext,
	getAccountNameLengths,
	listActiveAuthPlugins,
	loadEditBase,
	parseLoginForm,
	parsePasswordFields
} from '#lib/server/privileges/index.ts';
import { authPluginsFor } from '#lib/sql/privileges/index.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const ctx = await editContext(locals, url);
	const base = await loadEditBase(ctx);
	const common = { account: ctx.account, server: ctx.server, isGrantUser: ctx.caps.isGrantUser };
	if (base.state !== 'ok') return { ...common, ...base };
	const plugins = authPluginsFor(ctx.server, await listActiveAuthPlugins(ctx.dbi));
	return {
		...common,
		state: 'ok' as const,
		canCopy: ctx.caps.isCreateUser && ctx.caps.isGrantUser,
		plugins,
		plugin: base.details.properties.plugin,
		lengths: await getAccountNameLengths(ctx.dbi)
	};
};

export const actions: Actions = {
	login: async ({ request, locals, url }) => {
		const ctx = await editContext(locals, url);
		const parsed = parseLoginForm(
			await request.formData(),
			ctx.account,
			await getAccountNameLengths(ctx.dbi)
		);
		if (!parsed.ok) return fail(400, { error: parsed.error, results: [] });
		const res = await changeLogin(ctx.dbi, ctx.server, ctx.caps, parsed.value);
		if (!res.ok) return fail(400, { error: res.error ?? null, results: res.results });
		const to = parsed.value.to;
		return {
			saved:
				parsed.value.mode === 4
					? `The account '${to.user}'@'${to.host}' was created with the same privileges.`
					: `The account was changed to '${to.user}'@'${to.host}'.`,
			newAccount: to,
			oldRemoved: parsed.value.mode !== 4,
			results: res.results
		};
	},

	password: async ({ request, locals, url }) => {
		const ctx = await editContext(locals, url);
		if (!ctx.caps.isGrantUser) {
			return fail(403, {
				error: 'You do not have the privileges to administrate the users!',
				results: []
			});
		}
		const fd = await request.formData();
		const mode = fd.get('pred_password') === 'none' ? 'none' : 'userdefined';
		const pw = parsePasswordFields(fd, mode);
		if (!pw.ok) return fail(400, { error: pw.error, results: [] });
		const plugins = authPluginsFor(ctx.server, await listActiveAuthPlugins(ctx.dbi)).map(
			(p) => p.name
		);
		const plugin = String(fd.get('authentication_plugin') ?? '');
		if (plugin !== '' && !plugins.includes(plugin)) {
			return fail(400, { error: 'Unknown authentication plugin.', results: [] });
		}
		const res = await changePassword(ctx.dbi, ctx.server, {
			account: ctx.account,
			password: pw.value,
			plugin: plugin || undefined
		});
		if (!res.ok) return fail(400, { error: res.error ?? null, results: res.results });
		return { saved: 'The password for the account has been changed.', results: res.results };
	}
};
