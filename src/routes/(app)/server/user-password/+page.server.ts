import { fail } from '@sveltejs/kit';
import { updateSessionPassword } from '#lib/server/auth/index.ts';
import {
	errorText,
	changePassword,
	getAccountPlugin,
	getCurrentAccount,
	getPrivServer,
	listActiveAuthPlugins,
	parsePasswordFields
} from '#lib/server/privileges/index.ts';
import { authPluginsFor } from '#lib/sql/privileges/index.ts';
import type { Actions, PageServerLoad } from './$types';

const allowed = (locals: App.Locals) =>
	locals.config.ShowChgPassword && locals.session?.authType !== 'config';

export const load: PageServerLoad = async ({ locals }) => {
	if (!allowed(locals)) return { denied: true as const };
	const dbi = await locals.dbi;
	const server = await getPrivServer(dbi);
	const account = await getCurrentAccount(dbi);
	const plugin = await getAccountPlugin(dbi, server, account);
	const plugins = authPluginsFor(server, await listActiveAuthPlugins(dbi)).filter(
		(p) => !p.passwordless
	);
	return { denied: false as const, account, plugin, plugins, authType: locals.session?.authType };
};

export const actions: Actions = {
	default: async ({ request, locals, cookies, url }) => {
		if (!allowed(locals))
			return fail(403, { error: locals.i18n.t("You don't have sufficient privileges to be here right now!") });
		const fd = await request.formData();
		const none = fd.get('nopass') === '1';
		const pw = parsePasswordFields(fd, none ? 'none' : 'userdefined');
		if (!pw.ok) return fail(400, { error: errorText(pw, locals.i18n) });
		const dbi = await locals.dbi;
		const server = await getPrivServer(dbi);
		const account = await getCurrentAccount(dbi);
		const plugin = String(fd.get('authentication_plugin') ?? '');
		const res = await changePassword(dbi, server, {
			account,
			password: pw.value,
			plugin: plugin || undefined
		});
		if (!res.ok)
			return fail(400, {
				error: errorText(res, locals.i18n) ?? locals.i18n.t('Could not change the password.'),
				results: res.results
			});
		// Keep the user logged in: re-seal the session cookie with the new password.
		const relogin = !updateSessionPassword({ cookies, url, config: locals.config }, pw.value);
		return { changed: true, relogin, results: res.results };
	}
};
