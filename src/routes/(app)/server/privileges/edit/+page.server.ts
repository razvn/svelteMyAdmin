import { errorText } from '#lib/server/privileges/index.ts';
import { fail, redirect } from '@sveltejs/kit';
import {
	accountQuerySchema,
	getCapabilities,
	getPrivServer,
	parseGlobalForm,
	readAccount,
	resolveAccount,
	updateGlobalPrivileges
} from '#lib/server/privileges/index.ts';
import type { Actions, PageServerLoad } from './$types';

function account(url: URL) {
	const p = accountQuerySchema.safeParse({
		username: url.searchParams.get('username'),
		hostname: url.searchParams.get('hostname')
	});
	return p.success ? { user: p.data.username, host: p.data.hostname } : null;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const raw = account(url);
	if (!raw) redirect(303, '/server/privileges');
	const dbi = await locals.dbi;
	const [server, caps] = await Promise.all([getPrivServer(dbi), getCapabilities(dbi)]);
	const acc = resolveAccount(server, raw);
	const base = { account: acc, server, isGrantUser: caps.isGrantUser };
	if (!caps.isGrantUser && !caps.isSuperUser) return { ...base, state: 'denied' as const };
	const d = await readAccount(dbi, server, acc);
	if (!d.properties.exists && d.grantsError) {
		return { ...base, state: 'missing' as const, error: d.grantsError };
	}
	return {
		...base,
		state: 'ok' as const,
		isSelf: caps.currentUser.user === acc.user && caps.currentUser.host === acc.host,
		plugin: d.properties.plugin,
		inUserTable: d.properties.exists,
		initial: {
			privileges: d.grants.global.privileges,
			grantOption: d.grants.global.grantOption,
			ssl: d.properties.ssl,
			limits: d.properties.limits
		},
		other: {
			databases: d.grants.databases.length,
			tables: d.grants.tables.length,
			routines: d.grants.routines.length
		}
	};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const raw = account(url);
		if (!raw) return fail(400, { error: locals.i18n.t('Missing account.'), results: [] });
		const dbi = await locals.dbi;
		const [server, caps] = await Promise.all([getPrivServer(dbi), getCapabilities(dbi)]);
		const acc = resolveAccount(server, raw);
		const res = await updateGlobalPrivileges(
			dbi,
			server,
			caps,
			parseGlobalForm(await request.formData(), acc)
		);
		if (!res.ok) return fail(400, { error: errorText(res, locals.i18n), results: res.results });
		return { saved: true, results: res.results };
	}
};
