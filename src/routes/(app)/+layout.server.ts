import { redirect } from '@sveltejs/kit';
import { serverLabel } from '#lib/server/auth/index.ts';
import { switchableServers } from '#lib/server/discovery/switchable.ts';
import { toNavConfig } from '#lib/server/navigation/config.ts';
import type { LayoutServerLoad } from './$types';

function consoleMode(config: App.Locals['config']): 'info' | 'show' | 'collapse' {
	const mode = (config as { Console?: { Mode?: unknown } }).Console?.Mode;
	return mode === 'show' || mode === 'collapse' ? mode : 'info';
}

export const load: LayoutServerLoad = async ({ locals }) => {
	const s = locals.session;
	if (!s) redirect(303, '/login');

	const { config } = locals;
	const dbi = await locals.dbi;
	const databases = await dbi.listDatabases();
	const info = await dbi.getServerInfo();
	const hostLabel = s.port ? `${s.host}:${s.port}` : s.host;

	return {
		session: {
			user: s.user,
			identity: s.identity ?? null,
			host: hostLabel,
			serverLabel: serverLabel(locals.server),
			serverId: locals.serverId,
			// phpMyAdmin hides "Log out" for config auth (nothing to log out of)
			canLogout: s.authType !== 'config',
			// phpMyAdmin: ShowChgPassword and not config auth (the password is fixed there); signon
			// shares the configured account too, so a password change would lock everybody out
			canChangePassword:
				config.ShowChgPassword && s.authType !== 'config' && s.authType !== 'signon'
		},
		servers: await switchableServers(locals),
		nav: toNavConfig(config),
		consoleMode: consoleMode(config),
		databases,
		dialect: (info.serverType === 'MariaDB' ? 'mariadb' : 'mysql') as 'mariadb' | 'mysql'
	};
};
