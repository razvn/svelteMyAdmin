import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { getStatusData } from '#lib/server/admin/status.ts';
import { serverLabel } from '#lib/server/auth/index.ts';
import { getAppInfo } from '#lib/server/app-info.ts';
import { COLLATION_COOKIE } from '#lib/server/db/collation-cookie.ts';
import { isValidCollationName } from '#lib/server/db/connection.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const dbi = await locals.dbi;
	const conn = await locals.db;
	const [info, collations, ssl, status] = await Promise.all([
		dbi.getServerInfo(),
		dbi.listCollations(),
		dbi.isSslConnection().catch(() => false),
		// Only feeds the KPI cards: the page still renders when the user may not read the status.
		getStatusData(conn)
			.then((d) => d.status)
			.catch(() => null)
	]);
	const num = (key: string) => Number(status?.[key] ?? 0) || 0;
	const uptime = num('Uptime');
	const s = locals.session;
	const server = locals.server;
	const useSocket = !!server.socket && !s?.arbitrary;
	const hostPort = s?.port ? `${s.host}:${s.port}` : (s?.host ?? '');
	return {
		server: {
			label: serverLabel(server),
			connection: useSocket ? `${server.socket} via UNIX socket` : `${hostPort} via TCP/IP`,
			type: info.serverType,
			version: `${info.version} - ${info.versionComment}`,
			protocolVersion: info.protocolVersion,
			user: info.connectionUser,
			charset: info.charset === 'utf8mb4' ? 'UTF-8 Unicode (utf8mb4)' : info.charset,
			ssl
		},
		kpi: {
			version: info.version,
			uptime,
			questionsPerHour: uptime > 0 ? (num('Questions') * 3600) / uptime : 0,
			threadsConnected: num('Threads_connected'),
			available: status !== null
		},
		collation: info.collation,
		collations: collations.map((c) => ({ name: c.name, charset: c.charset })),
		showChgPassword: locals.config.ShowChgPassword,
		webServer: getAppInfo()
	};
};

const collationSchema = z.object({ collation_connection: z.string().min(1).max(64) });

export const actions: Actions = {
	/** "Server connection collation": remembered in a cookie, applied when the connection opens. */
	collation: async ({ request, cookies, url, locals }) => {
		const parsed = collationSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success || !isValidCollationName(parsed.data.collation_connection)) {
			return fail(400, { collationError: 'Invalid collation.' });
		}
		const dbi = await locals.dbi;
		const known = (await dbi.listCollations()).some(
			(c) => c.name === parsed.data.collation_connection
		);
		if (!known) return fail(400, { collationError: 'Unknown collation.' });
		cookies.set(COLLATION_COOKIE, parsed.data.collation_connection, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 365
		});
		return { collationSaved: parsed.data.collation_connection };
	}
};
