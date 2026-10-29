import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
	createAccount,
	getAccountNameLengths,
	getCapabilities,
	getPrivServer,
	getThisHost,
	listActiveAuthPlugins,
	parseNewAccountForm
} from '#lib/server/privileges/index.ts';
import { authPluginsFor, defaultAuthPlugin } from '#lib/sql/privileges/index.ts';
import type { Actions, PageServerLoad } from './$types';

const dbParam = z.string().max(64).catch('');

async function context(dbi: Awaited<App.Locals['dbi']>) {
	const [server, caps, active, lengths, thisHost] = await Promise.all([
		getPrivServer(dbi),
		getCapabilities(dbi),
		listActiveAuthPlugins(dbi),
		getAccountNameLengths(dbi),
		getThisHost(dbi)
	]);
	const plugins = authPluginsFor(server, active);
	return { server, caps, plugins, lengths, thisHost };
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const { server, caps, plugins, lengths, thisHost } = await context(await locals.dbi);
	const defaultPlugin = defaultAuthPlugin(server);
	return {
		server,
		caps: { isCreateUser: caps.isCreateUser, isGrantUser: caps.isGrantUser },
		plugins,
		defaultPlugin: plugins.some((p) => p.name === defaultPlugin)
			? defaultPlugin
			: (plugins[0]?.name ?? ''),
		lengths,
		// "This host" is only useful when it differs from localhost
		thisHost: thisHost && thisHost !== 'localhost' && thisHost !== '127.0.0.1' ? thisHost : '',
		/** Coming from a database page: offer "Grant all privileges on database X". */
		database: dbParam.parse(url.searchParams.get('dbname') ?? '')
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const fd = await request.formData();
		const { server, caps, plugins, lengths, thisHost } = await context(await locals.dbi);
		if (!caps.isCreateUser) {
			return fail(403, {
				error: 'You do not have the privileges to administrate the users!',
				results: []
			});
		}
		const parsed = parseNewAccountForm(fd, {
			lengths,
			thisHost,
			plugins: plugins.map((p) => p.name)
		});
		if (!parsed.ok) return fail(400, { error: parsed.error, results: [] });
		const res = await createAccount(await locals.dbi, server, caps, parsed.value);
		if (!res.ok) return fail(400, { error: res.error ?? null, results: res.results });
		return {
			created: { user: parsed.value.account.user, host: parsed.value.account.host },
			results: res.results
		};
	}
};
