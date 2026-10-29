import { isBinlogEnabled } from '#lib/server/admin/binlog.ts';
import { guardTab } from '#lib/server/pmadb/user-groups.ts';
import type { LayoutServerLoad } from './$types';

/** The "Binary log" tab only exists when `log_bin` is ON; user groups may hide further tabs. */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	const deniedTabs = await guardTab(locals, 'server', {}, url.pathname);
	return { binlog: await isBinlogEnabled(await locals.db), deniedTabs };
};
