import { error } from '@sveltejs/kit';
import { z } from 'zod';
import {
	BINLOG_PAGE_SIZE,
	getBinlogEvents,
	isBinlogEnabled,
	listBinlogs
} from '#lib/server/admin/binlog.ts';
import type { PageServerLoad } from './$types';

const query = z.object({
	file: z.string().max(255).optional(),
	offset: z.coerce.number().int().min(0).max(1_000_000_000).catch(0),
	full: z.enum(['1']).optional().catch(undefined)
});

export const load: PageServerLoad = async ({ locals, url }) => {
	const conn = await locals.db;
	if (!(await isBinlogEnabled(conn))) error(404, locals.i18n.t('Binary logging is not enabled on this server.'));
	const q = query.parse(Object.fromEntries(url.searchParams));
	const files = await listBinlogs(conn);
	// only files listed by SHOW BINARY LOGS are accepted
	const file = files.find((f) => f.name === q.file)?.name ?? files.at(-1)?.name ?? null;
	const page = file ? await getBinlogEvents(conn, file, q.offset) : { events: [], hasMore: false };
	return {
		files,
		file,
		offset: q.offset,
		pageSize: BINLOG_PAGE_SIZE,
		full: q.full === '1',
		...page
	};
};
