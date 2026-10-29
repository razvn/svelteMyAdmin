import { getLoggingVars } from '#lib/server/admin/monitor.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const conn = await locals.db;
	const [[rows], vars] = await Promise.all([
		conn.query('SHOW GLOBAL STATUS'),
		getLoggingVars(conn).catch(() => null)
	]);
	const statusNames = (rows as Record<string, unknown>[]).map((r) => String(r.Variable_name));
	return { statusNames, logging: vars };
};
