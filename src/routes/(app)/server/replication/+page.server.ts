import { getReplication } from '#lib/server/admin/replication.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [conn, dbi] = await Promise.all([locals.db, locals.dbi]);
	const info = await dbi.getServerInfo();
	return { replication: await getReplication(conn, info) };
};
