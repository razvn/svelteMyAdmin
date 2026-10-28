import { isBinlogEnabled } from '#lib/server/admin/binlog.ts';
import type { LayoutServerLoad } from './$types';

/** The "Binary log" tab only exists when `log_bin` is ON. */
export const load: LayoutServerLoad = async ({ locals }) => {
	return { binlog: await isBinlogEnabled(await locals.db) };
};
