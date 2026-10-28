import { serverLabel } from '#lib/server/auth/index.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const s = locals.session;
	return {
		user: s?.user ?? '',
		host: s?.port ? `${s.host}:${s.port}` : (s?.host ?? ''),
		serverLabel: serverLabel(locals.server),
		canLogout: true
	};
};
