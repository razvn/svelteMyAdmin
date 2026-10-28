import { redirect } from '@sveltejs/kit';
import { serverLabel } from '#lib/server/auth/index.ts';
import { toNavConfig } from '#lib/server/navigation/config.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const s = locals.session;
	if (!s) redirect(303, '/login');

	const { config } = locals;
	const dbi = await locals.dbi;
	const databases = await dbi.listDatabases();
	const hostLabel = s.port ? `${s.host}:${s.port}` : s.host;

	return {
		session: {
			user: s.user,
			host: hostLabel,
			serverLabel: serverLabel(locals.server),
			serverIndex: locals.serverIndex,
			// phpMyAdmin hides "Log out" for config auth (nothing to log out of)
			canLogout: s.authType !== 'config'
		},
		servers: config.Servers.map((server, i) => ({
			index: i + 1,
			label: serverLabel(server),
			auth: server.auth_type
		})),
		nav: toNavConfig(config),
		databases
	};
};
